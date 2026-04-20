---
id: 02-typescript-generic-functions
language: typescript
title: "Generic functions in TypeScript"
estimatedMinutes: 10
prerequisites: [01-javascript-loops-and-arrays]
---

## English

### What you will build

A reusable `pickFirst<T>` function that takes an array of any type
and returns the first element typed correctly. By the end you will
have written your first generic function, narrowed it with a
constraint, and seen the TypeScript service in Monaco surface the
correct return type as you type.

### Starter code

```typescript
// Goal: write `pickFirst<T>` that takes T[] and returns T | undefined.
function pickFirst(values: unknown[]): unknown {
  return values[0];
}

// Try it on a few inputs:
const firstNumber = pickFirst([10, 20, 30]); //=> typed as `unknown` today
const firstName = pickFirst(["Ada", "Linus", "Grace"]); //=> typed as `unknown` today

console.log({ firstNumber, firstName });
```

### Walkthrough

1. **Add a type parameter** to the signature:

   ```typescript
   function pickFirst<T>(values: T[]): T | undefined {
     return values[0];
   }
   ```

   Hover `firstNumber` in the editor — Monaco now shows
   `number | undefined`. The same call against the strings array
   resolves to `string | undefined`.

2. **Add a constraint** so only arrays of objects are accepted:

   ```typescript
   function pickFirstObject<T extends object>(values: T[]): T | undefined {
     return values[0];
   }
   ```

   Try `pickFirstObject([1, 2, 3])` — the TypeScript service
   underlines the call with a diagnostic and you can read it in
   the result panel.

3. **Default the type parameter** so old calls without an explicit
   type still work:

   ```typescript
   function pickFirstWithDefault<T = string>(values: T[]): T | undefined {
     return values[0];
   }
   ```

### Try it yourself

- Write a generic `pickLast<T>` mirror of `pickFirst`. Hover the
  return type in Monaco and confirm it matches.
- Use a generic constraint to require the input to extend
  `{ id: string }` and write `pickFirstById`.
- Use the inline `//=>` magic comment to print the inferred
  return type without a `console.log`.

### What you learned

- A type parameter `<T>` lets one function work on every input
  type without dropping to `unknown` or `any`.
- A constraint (`T extends ...`) lets you narrow what `T` is
  allowed to be while keeping the genericity.
- Lingua ships Monaco's TypeScript service in the Free tier — you
  do not need a paid license to write or run TS.

---

## Español

### Lo que vas a construir

Una función reutilizable `pickFirst<T>` que recibe un arreglo de
cualquier tipo y devuelve el primer elemento tipado
correctamente. Al final habrás escrito tu primera función
genérica, la habrás restringido con una constraint y verás cómo
el servicio de TypeScript en Monaco muestra el tipo de retorno
correcto mientras escribes.

### Código inicial

```typescript
// Meta: escribe `pickFirst<T>` que reciba T[] y devuelva T | undefined.
function pickFirst(values: unknown[]): unknown {
  return values[0];
}

// Pruébalo con varias entradas:
const primerNumero = pickFirst([10, 20, 30]); //=> hoy se tipa como `unknown`
const primerNombre = pickFirst(["Ada", "Linus", "Grace"]); //=> hoy se tipa como `unknown`

console.log({ primerNumero, primerNombre });
```

### Paso a paso

1. **Agrega un parámetro de tipo** a la firma:

   ```typescript
   function pickFirst<T>(values: T[]): T | undefined {
     return values[0];
   }
   ```

   Pasa el cursor sobre `primerNumero` en el editor — Monaco
   ahora muestra `number | undefined`. La misma llamada contra el
   arreglo de strings se resuelve como `string | undefined`.

2. **Agrega una constraint** para que solo se acepten arreglos de
   objetos:

   ```typescript
   function pickFirstObject<T extends object>(values: T[]): T | undefined {
     return values[0];
   }
   ```

   Prueba `pickFirstObject([1, 2, 3])` — el servicio de
   TypeScript subraya la llamada con una diagnóstica y puedes
   leerla en el panel de resultados.

3. **Pon un valor por defecto** al parámetro de tipo para que las
   llamadas antiguas sigan funcionando:

   ```typescript
   function pickFirstWithDefault<T = string>(values: T[]): T | undefined {
     return values[0];
   }
   ```

### Inténtalo tú

- Escribe el espejo genérico `pickLast<T>` de `pickFirst`. Pasa
  el cursor por el tipo de retorno en Monaco y confirma que
  coincide.
- Usa una constraint para exigir que la entrada extienda
  `{ id: string }` y escribe `pickFirstById`.
- Usa los comentarios mágicos `//=>` para mostrar el tipo de
  retorno inferido sin un `console.log`.

### Lo que aprendiste

- Un parámetro de tipo `<T>` permite que una función funcione con
  cualquier tipo de entrada sin caer a `unknown` o `any`.
- Una constraint (`T extends ...`) te permite acotar qué puede
  ser `T` sin perder la genericidad.
- Lingua incluye el servicio de TypeScript de Monaco en el plan
  Free — no necesitas una licencia de pago para escribir ni
  ejecutar TS.
