---
id: 01-javascript-loops-and-arrays
language: javascript
title: "Loops and arrays in JavaScript"
estimatedMinutes: 8
prerequisites: []
---

## English

### What you will build

A small JavaScript snippet that takes an array of numbers, filters
out the negative ones, doubles what's left, and prints the running
sum. By the end you will have used `filter`, `map`, and a `for`
loop in the same file and seen the inline result panel update as
you change the input.

### Starter code

```javascript
const numbers = [3, -2, 7, 0, -5, 11];

// 1. Filter out the negatives.
const positives = numbers; //=> replace this with a filter call

// 2. Double what's left.
const doubled = positives; //=> replace this with a map call

// 3. Sum the doubled values with a for loop.
let total = 0;
//=> walk `doubled` and add each entry to `total`

console.log({ positives, doubled, total });
```

### Walkthrough

1. **`filter` keeps the entries that match**. Replace step 1 with
   `numbers.filter((n) => n >= 0)`. The inline result panel will
   show the new array next to the line.
2. **`map` transforms each entry**. Replace step 2 with
   `positives.map((n) => n * 2)`. The result panel updates again.
3. **The `for` loop walks the array**. Replace the placeholder
   with:

   ```javascript
   for (const value of doubled) {
     total += value;
   }
   ```

### Try it yourself

- Add `13` to the input array. What does `total` become?
- Replace the `for` loop with `doubled.reduce((acc, n) => acc + n, 0)`.
  Does the result match?
- Use `//=>` magic comments on the line that builds `positives`
  to surface the intermediate value without a `console.log`.

### What you learned

- `filter`, `map`, and a classic `for` loop work together in plain
  JavaScript without any libraries.
- Lingua's inline result panel and `//=>` magic comments make the
  intermediate values visible without breakpoints.
- The Free tier is enough to run this lesson — JavaScript is
  available on every plan.

---

## Español

### Lo que vas a construir

Un pequeño snippet de JavaScript que toma un arreglo de números,
filtra los negativos, duplica lo que queda y muestra la suma
acumulada. Al final habrás usado `filter`, `map` y un bucle `for`
en el mismo archivo y verás cómo el panel de resultados en línea
se actualiza al cambiar la entrada.

### Código inicial

```javascript
const numeros = [3, -2, 7, 0, -5, 11];

// 1. Filtra los negativos.
const positivos = numeros; //=> reemplaza esto con una llamada a filter

// 2. Duplica lo que queda.
const duplicados = positivos; //=> reemplaza esto con una llamada a map

// 3. Suma los valores duplicados con un bucle for.
let total = 0;
//=> recorre `duplicados` y suma cada entrada a `total`

console.log({ positivos, duplicados, total });
```

### Paso a paso

1. **`filter` conserva las entradas que cumplen la condición**.
   Reemplaza el paso 1 con `numeros.filter((n) => n >= 0)`. El
   panel de resultados en línea mostrará el nuevo arreglo al
   lado de la línea.
2. **`map` transforma cada entrada**. Reemplaza el paso 2 con
   `positivos.map((n) => n * 2)`. El panel se actualiza de nuevo.
3. **El bucle `for` recorre el arreglo**. Reemplaza el placeholder
   con:

   ```javascript
   for (const valor of duplicados) {
     total += valor;
   }
   ```

### Inténtalo tú

- Agrega `13` al arreglo de entrada. ¿Qué valor toma `total`?
- Reemplaza el bucle `for` con
  `duplicados.reduce((acc, n) => acc + n, 0)`. ¿El resultado
  coincide?
- Usa los comentarios mágicos `//=>` en la línea que construye
  `positivos` para mostrar el valor intermedio sin un
  `console.log`.

### Lo que aprendiste

- `filter`, `map` y un bucle `for` clásico funcionan juntos en
  JavaScript puro, sin librerías.
- El panel de resultados en línea de Lingua y los comentarios
  mágicos `//=>` hacen visibles los valores intermedios sin
  necesidad de breakpoints.
- El plan Free alcanza para correr esta lección — JavaScript está
  disponible en todos los planes.
