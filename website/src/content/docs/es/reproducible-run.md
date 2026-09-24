---
title: De un fragmento a evidencia reproducible
description: Ejecuta un ejemplo local de JavaScript, recupérate de un error y entrega una cápsula revisada a la CLI sin confundir validación con ejecución.
order: 2
section: guide
---

Este recorrido usa un scratchpad de JavaScript: no necesita solicitudes de red
ni crear un proyecto. Editar, ejecutar, revisar errores, recuperarte y
**exportar la última cápsula** funciona en Free, tanto en el navegador como en
la app de escritorio. El navegador necesita una primera carga con conexión.
Para los pasos de la CLI, instala la CLI por separado y usa Node.js 24;
[consulta la guía de la CLI](/es/cli). Go, Rust y el MCP local son específicos
de escritorio, no de esta demo. Donde está disponible, el navegador accede a
archivos mediante permisos de File System Access; escritorio usa su puente
nativo de archivos y observación de cambios.

## 1. Ejecuta y revisa la salida

Abre [Lingua en tu navegador](https://app.linguacode.dev) o la app de
escritorio. Usa una pestaña JavaScript con el runtime Worker predeterminado.
Reemplaza el contenido del editor por:

```js
const x = 1 + 2; console.log(x);
```

Selecciona **Ejecutar** (o presiona `Cmd/Ctrl+Enter`). La consola debe mostrar
`3`.

## 2. Provoca un error y recupérate

Reemplaza el código con este fallo deliberado y vuelve a ejecutar:

```js
throw new Error('demo failure');
```

Revisa el error en la consola. Vuelve al primer ejemplo y ejecútalo otra vez:
el nuevo resultado debe ser `3`. Esta es una prueba de recuperación, no una
promesa de que todos los errores se arreglen automáticamente. **Detener**
cancela la ejecución actual; no repite el código anterior en silencio.

## 3. Guarda una ejecución revisada

Ve a **Configuración → Cuenta → Cápsulas de ejecución → Guardar JSON para CLI**.
El navegador descarga `lingua-run.capsule.json`; la app de escritorio abre un
diálogo local para guardar. En Free puedes exportar la última ejecución. La
consulta ampliada del historial y los snapshots de código opt-in son de pago;
no los necesitas aquí.

Abre el JSON y revisa `source.content`, `result.stdout` y los metadatos
protegidos **antes de compartirlo**. La exportación incluye tu código y puede
incluir entradas y salidas; no es un evento de telemetría anónimo. Importar el
archivo a Lingua abre una vista previa sin ejecutarlo.

## 4. Valida y luego reproduce código confiable de forma explícita

Abre una terminal en la carpeta del archivo. La validación revisa la estructura,
pero **no ejecuta el código**:

```bash
lingua capsule validate "lingua-run.capsule.json" --json
```

Solo después de revisar el código y decidir que confías en él, usa el comando
independiente:

```bash
lingua capsule replay "lingua-run.capsule.json" --json
```

Replay ejecuta con tus permisos del sistema operativo. La comparación indica
si el estado y la salida nuevos coinciden con los registrados; no promete
resultados idénticos con solicitudes de red, el reloj, dependencias o máquinas
distintas. La [guía de cápsulas de la CLI](/es/cli/capsules) explica los límites
del hash y de Workspace.

## Repite la verificación de la CLI sin abrir la app

El repositorio incluye un
[ejemplo fijo de `RunCapsuleV1`](https://github.com/johnny4young/lingua/blob/main/docs/examples/deterministic-run.capsule.json).
Desde una copia local del repositorio, ejecuta:

```bash
lingua capsule validate docs/examples/deterministic-run.capsule.json --json
lingua capsule replay docs/examples/deterministic-run.capsule.json --json
```

El ejemplo registra `3\n`; con Node.js 24, la comparación de replay debe
indicar `matches: true`. El hash detecta inconsistencias, no ataques: un
archivo alterado puede incluir un hash recalculado. Nunca reproduzcas una
cápsula de origen desconocido.

**Límite de agentes:** las herramientas del MCP local de escritorio son de
solo lectura y no ejecutan código. Un agente con acceso a la shell y a la CLI
independiente tiene otra autoridad: validar es inerte; replay es una decisión
explícita de ejecución. Lee la [guía de integración con agentes](/es/cli/ai-agents)
antes de habilitar cualquiera de los dos.
