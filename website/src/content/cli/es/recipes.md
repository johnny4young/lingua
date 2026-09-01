---
title: Recetas prácticas para el desarrollo diario
description: Copia patrones del CLI de Lingua para APIs, datos, scripts locales, hooks de Git, CI, contenedores, Capsules, Bash y PowerShell.
order: 35
group: guides
keywords: [recetas, ejemplos, api, curl, jq, hook git, github actions, npm scripts, makefile, docker, powershell, ci]
---

Estas recetas resuelven tareas pequeñas y frecuentes con comandos que puedes copiar y adaptar. Asumen que `lingua --version` funciona y que confías en cada archivo o programa que vas a ejecutar.

## Elige una receta según el resultado

| Necesitas… | Receta |
| --- | --- |
| inspeccionar la respuesta de una API | [Formatea JSON desde curl](#formatea-json-desde-curl) |
| revisar un token sin subirlo a internet | [Lee el header y payload de un JWT](#lee-el-header-y-payload-de-un-jwt) |
| construir una consulta URL segura | [Codifica un componente de URL](#codifica-un-componente-de-url) |
| normalizar archivos generados | [Protege el formato JSON con un hook de Git](#protege-el-formato-json-con-un-hook-de-git) |
| ejecutar una revisión del repositorio | [Expón Lingua mediante package.json](#expón-lingua-mediante-packagejson) |
| agregar un gate de CI | [Fija el CLI en GitHub Actions](#fija-el-cli-en-github-actions) |
| reproducir una ejecución capturada | [Exige una repetición exacta de una Capsule](#exige-una-repetición-exacta-de-una-capsule) |
| usar Lingua desde Windows | [Conserva el código de salida en PowerShell](#conserva-el-código-de-salida-en-powershell) |

## Trabaja con APIs y datos web

### Formatea JSON desde curl

Mantén el JSON transformado en stdout para poder pasarlo a `jq`:

```bash
curl -fsSL https://api.github.com/repos/johnny4young/lingua \
  | lingua utility json-format --quiet \
  | jq '{name, stargazers_count, open_issues_count}'
```

`curl -f` hace fallar el pipe ante un error HTTP. En jobs de CI con Bash, agrega `set -o pipefail` para que un comando posterior no oculte una falla anterior.

### Minifica un artefacto JSON de release

```bash
lingua utility json-minify --input config/runtime.json --quiet \
  > dist/runtime.min.json
```

El comando analiza el JSON antes de escribir. Una entrada inválida falla en vez de producir un artefacto transformado parcialmente.

### Lee el header y payload de un JWT

```bash
printf '%s' "$ACCESS_TOKEN" \
  | lingua utility jwt-decode --quiet \
  | jq '{algorithm: .header.alg, subject: .payload.sub, expires: .payload.exp}'
```

Esto solo decodifica texto local. **No** verifica la firma, el issuer, la audience, la expiración ni la autorización. Nunca trates los claims decodificados como una identidad confiable.

### Codifica un componente de URL

```bash
query=$(printf '%s' 'state:open label:"good first issue"' \
  | lingua utility url-encode --quiet)

curl -fsSL "https://api.github.com/search/issues?q=${query}" | jq '.total_count'
```

`url-encode` sirve para un componente, como el valor de una consulta, no para volver a codificar una URL completa.

### Separa una URL absoluta en campos

```bash
printf '%s' 'https://example.com:8443/api/items?limit=20#results' \
  | lingua utility url-parse --quiet \
  | jq '{origin, pathname, searchParams}'
```

`url-parse` rechaza deliberadamente las URLs relativas. Resuelve primero una ruta relativa contra su base.

### Codifica o decodifica texto en Base64

```bash
encoded=$(printf '%s' 'valor local de desarrollo' | lingua utility base64-encode --quiet)
printf '%s' "$encoded" | lingua utility base64-decode --quiet
```

El contrato del CLI es texto UTF-8. Base64 es una codificación, no cifrado, y esta receta no está pensada para archivos binarios arbitrarios ni secretos.

### Escapa un snippet como texto HTML

```bash
printf '%s' '<button data-id="42">Ejecutar & revisar</button>' \
  | lingua utility html-entity-encode --quiet
```

Esto escapa contenido textual. No sanitiza un documento HTML ni vuelve seguro ejecutar markup no confiable.

## Normaliza texto y datos de desarrollo

### Calcula el digest de un texto

```bash
digest=$(lingua utility hash \
  --input release-notes.md \
  --option algorithm=SHA-256 \
  --quiet)
printf 'release-notes.md  %s\n' "$digest"
```

El digest cubre el texto UTF-8 leído por el CLI. Usa una herramienta de checksum del sistema cuando necesites procesar byte por byte un archivo binario arbitrario.

### Ordena y elimina rutas duplicadas

```bash
git diff --name-only origin/main...HEAD \
  | lingua utility line-sort \
      --option unique=true \
      --option caseInsensitive=true \
      --quiet
```

Agrega `--option numeric=true` cuando valores como `fixture2` y `fixture10` deban usar orden natural.

### Produce nombres con un estilo estable

```bash
printf '%s' 'HTTP response cache key' \
  | lingua utility string-case --option target=snake --quiet

printf '%s' 'Guía rápida para equipos' \
  | lingua utility slugify --option separator=hyphen --quiet
```

Usa `string-case` para nombres de código (`camel`, `snake`, `kebab` y otros). Usa `slugify` para un segmento ASCII de URL o nombre de archivo.

### Reemplaza un patrón repetido en código

```bash
lingua utility regex-replace \
  --input src/legacy.ts \
  --option pattern='console\\.log' \
  --option flags=g \
  --option replacement=logger.info \
  --quiet > /tmp/legacy.updated.ts

diff -u src/legacy.ts /tmp/legacy.updated.ts
```

Revisa el diff antes de reemplazar el archivo original. Pon el patrón entre comillas para que el shell no interprete backslashes ni metacaracteres.

### Inspecciona Unicode sospechoso

```bash
git log -1 --pretty=%B | lingua utility string-inspect --quiet
```

El resultado distingue grafemas, code points, unidades UTF-16, bytes UTF-8, caracteres de ancho cero y controles bidireccionales. Es útil cuando dos strings se ven iguales, pero se comparan de forma diferente.

### Convierte un timestamp durante un incidente

```bash
printf '%s' '1735689600' | lingua utility timestamp --quiet
```

El resultado incluye ISO 8601, epoch en milisegundos y epoch en segundos. Registra aparte la zona horaria original cuando importe: un Unix epoch representa un instante, no la zona del autor.

### Convierte un entero sin perder precisión

```bash
printf '%s' '9007199254740993' \
  | lingua utility number-base \
      --option from=10 \
      --option to=16 \
      --option prefixOutput=true \
      --quiet
```

El conversor usa aritmética de enteros, no punto flotante. Los valores superiores al límite seguro de JavaScript permanecen exactos.

### Genera identificadores para pruebas

```bash
printf 'generator-input-is-ignored' \
  | lingua utility uuid \
      --option format=v7 \
      --option count=5 \
      --quiet
```

`uuid` es un generador: recibe stdin porque todas las utilidades comparten un contrato de entrada textual, pero lo ignora deliberadamente. Los valores generados no son snapshots deterministas.

### Traduce un horario a cron

```bash
printf '%s' 'weekdays at 9:30' \
  | lingua utility cron-phrase --option annotate=true --quiet
```

Mantén `annotate=true` durante la revisión: los comentarios adicionales muestran supuestos y advertencias de cron. Prueba la expresión final en la zona horaria y la implementación de cron que la ejecutarán.

### Inspecciona un color del sistema de diseño

```bash
printf '%s' 'rgba(14, 165, 233, 0.75)' \
  | lingua utility color-convert --quiet
```

La salida presenta formas equivalentes HEX, RGB/RGBA y HSL para compararlas rápidamente.

## Ejecuta herramientas del repositorio de forma consistente

### Pasa un fixture como stdin

```bash
lingua run ./scripts/normalize.py \
  --stdin ./fixtures/raw-event.json \
  --timeout 45000
```

Usa `--stdin` cuando la entrada ya tenga una ruta. Evita un pipe frágil y deja visible el fixture en la invocación.

### Envía argumentos al programa

```bash
lingua run ./scripts/check.ts \
  --timeout 60000 \
  -- --changed-only --format=json
```

Todo lo que está después de `--` pertenece a `check.ts`. Lingua no analiza ni reordena esos tokens.

### Ejecuta la raíz de un proyecto convencional

```bash
lingua run ./tools/release-audit --timeout 120000
```

La detección de directorios admite `package.json`, `go.mod`, `Cargo.toml` y entry points comunes. Ejecuta directamente el comando del framework cuando un repositorio necesite orquestación personalizada o un servidor permanente.

### Expón Lingua mediante package.json

Fija el CLI en `devDependencies` y ofrece al equipo un script fácil de recordar:

```json
{
  "devDependencies": {
    "@linguacode/cli": "1.4.1"
  },
  "scripts": {
    "check:local": "lingua run ./scripts/check.ts --timeout 60000 -- --changed-only",
    "check:capsules": "lingua capsule validate ./artifacts/latest.capsule.json --quiet"
  }
}
```

```bash
npm run check:local
```

Incluye el lockfile en Git. Actualiza la versión fijada únicamente después de pasar las mismas verificaciones en tu repositorio.

### Agrega un target de Make

```make
.PHONY: verify-fixtures
verify-fixtures:
	lingua run ./scripts/verify-fixtures.py --stdin ./fixtures/events.ndjson --timeout 90000
```

La línea de la receta debe comenzar con un tab. Make conserva el código de salida de Lingua, por lo que una ejecución fallida hace fallar el target.

### Protege el formato JSON con un hook de Git

Usa un archivo temporal en vez de reescribir automáticamente el archivo staged:

```bash
#!/usr/bin/env bash
set -euo pipefail

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

lingua utility json-format --input config/app.json --option indent=2 --quiet > "$tmp"
if ! cmp -s config/app.json "$tmp"; then
  echo 'config/app.json no tiene el formato canónico' >&2
  diff -u config/app.json "$tmp" || true
  exit 1
fi
```

Instálalo con el gestor de hooks que ya utilice el repositorio. Los hooks pueden omitirse, así que conserva el mismo invariante en CI.

## Integra Lingua en automatización

### Fija el CLI en GitHub Actions

```yaml
name: CLI checks
on: [pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx --no-install lingua run ./scripts/check.ts --json
      - run: npx --no-install lingua capsule validate ./artifacts/example.capsule.json --quiet
```

Esto asume que `@linguacode/cli` está fijado en el repositorio y el lockfile, como en la receta de `package.json`. Instala explícitamente cada toolchain cuando el objetivo no sea JavaScript o TypeScript.

### Conserva la salida estructurada y el código de salida

```bash
#!/usr/bin/env bash
set -uo pipefail

result=$(lingua run ./scripts/healthcheck.ts --json)
status=$?

printf '%s\n' "$result" | jq .
if (( status != 0 )); then
  printf 'Lingua falló con código %d\n' "$status" >&2
fi
exit "$status"
```

No agregues `|| true` a un gate salvo que la falla sea deliberadamente informativa. El JSON explica la falla; el código de salida decide si la automatización continúa.

### Ofrece recuperación de runtime sin analizar texto humano

```bash
result=$(lingua run ./worker.py --json)
status=$?

if (( status == 3 )); then
  printf '%s\n' "$result" | jq '{reason, recovery}' >&2
fi
exit "$status"
```

El código 3 indica que una capacidad no está disponible. El objeto `recovery` puede incluir runtime, ejecutable, comando o guía de instalación y comando de verificación.

### Valida todos los artefactos Capsule

```bash
#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r -d '' capsule; do
  lingua capsule validate "$capsule" --quiet
done < <(find artifacts -name '*.capsule.json' -type f -print0)
```

Esto valida estructura y límites sin ejecutar el código guardado. `-print0` mantiene como un solo elemento los nombres que contienen espacios; `set -e` se detiene ante el primer artefacto inválido.

### Exige una repetición exacta de una Capsule

```bash
lingua capsule replay ./artifacts/release-check.capsule.json \
  --timeout 60000 \
  --json \
  | jq -e '.ok == true and .comparison.matches == true'
```

Replay puede terminar con código 0 cuando el programa se ejecutó correctamente, pero produjo algo diferente del resultado registrado. `jq -e` convierte la comparación exacta en una política explícita de CI. Repite únicamente Capsules confiables.

### Construye una imagen pequeña de contenedor

```dockerfile
FROM node:24-bookworm-slim

RUN npm install --global @linguacode/cli@1.4.1
WORKDIR /workspace
ENTRYPOINT ["lingua"]
CMD ["--help"]
```

```bash
docker build -t local/lingua-cli .
docker run --rm -i local/lingua-cli utility json-format --quiet \
  < fixtures/payload.json
```

Monta código confiable y el toolchain necesario cuando uses `lingua run`. El contenedor es el límite de aislamiento; Lingua no es por sí mismo un sandbox del sistema operativo.

## Usa patrones nativos de cada shell

### Configura autocompletado en una estación de trabajo

```bash
lingua completion --dry-run
lingua completion
```

El primer comando muestra cada shell detectado y archivo de destino. El segundo pide confirmación una sola vez. Las instalaciones de Homebrew ubican automáticamente los archivos de Bash, Zsh y Fish.

### Conserva el código de salida en PowerShell

```powershell
$result = lingua run .\scripts\check.ts --json | ConvertFrom-Json
$status = $LASTEXITCODE

$result | ConvertTo-Json -Depth 8
if ($status -ne 0) {
  Write-Error "Lingua falló con código $status"
}
exit $status
```

Captura `$LASTEXITCODE` inmediatamente después de `lingua`; otro comando nativo puede reemplazarlo.

### Formatea un archivo en PowerShell

```powershell
Get-Content .\config\app.json -Raw |
  lingua utility json-format --option indent=4 --quiet |
  Set-Content .\config\app.formatted.json -Encoding utf8

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Escribe primero en un segundo archivo. Revísalo o compáralo antes de reemplazar el original.

## Descubre qué admite tu versión instalada

El registro instalado es la fuente de verdad cuando un script debe funcionar con diferentes versiones del CLI:

```bash
lingua list utilities --json \
  | jq -r '.utilities[] | [.id, (.optionKeys | join(","))] | @tsv'

lingua --help
lingua utility --help
lingua run --help
```

Prefiere descubrir las opciones en vez de adivinarlas. Para automatización estable, fija la versión del CLI e incluye el lockfile o la metadata inmutable del instalador.
