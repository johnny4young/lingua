---
id: 03-python-fundamentals
language: python
title: "List comprehensions and dict shaping in Python"
estimatedMinutes: 9
prerequisites: []
---

## English

### What you will build

A Python snippet that takes a list of raw purchase records,
normalizes the keys, discards incomplete entries, and then computes
a per-customer total using a list comprehension plus a plain `for`
loop. By the end you will have used `dict` literals, a list
comprehension with an `if` filter, `dict.get` with a default, and
`collections.defaultdict`, and you will have seen the inline result
panel update as you change the input.

### Starter code

```python
from collections import defaultdict

purchases = [
    {"customer": "a", "amount": 12.0},
    {"customer": "b", "amount": None},
    {"customer": "a", "amount": 3.5},
    {"amount": 7.0},
    {"customer": "c", "amount": 22.0},
]

# 1. Keep only entries that have a customer AND a numeric amount.
valid = purchases  #=> replace this with a list comprehension

# 2. Sum the amount per customer.
totals = defaultdict(float)
#=> walk `valid` and accumulate into `totals`

print(dict(totals))
```

### Walkthrough

1. **List comprehensions filter and shape in one line.** Replace
   step 1 with
   `[p for p in purchases if p.get("customer") and isinstance(p.get("amount"), (int, float))]`.
   The `get` call returns `None` for the record with no `customer`
   key, and the `isinstance` check drops the `amount: None` row. Run
   the file — the inline panel shows the list shrinking from 5 to 3
   entries.
2. **`defaultdict(float)` skips the "is this key here yet?" dance.**
   Walk `valid` with a regular `for` loop and write
   `totals[p["customer"]] += p["amount"]`. No `KeyError`, no
   `if customer in totals` branch.
3. **Cast to `dict` for the final print.** `defaultdict` repr is
   noisy; `dict(totals)` gives you a clean one-line output in the
   inline panel.

### Try it yourself

- Add a row with `"amount": "12"` (a string). The `isinstance` check
  drops it — change the guard to coerce via `float(p["amount"])` if
  you want to keep it.
- Switch the final line to
  `print(sorted(totals.items(), key=lambda kv: -kv[1]))` to rank
  customers by spend.
- Replace the list comprehension with a generator expression
  (`(p for p in purchases if ...)`) and watch `valid` become a
  one-shot iterator. The second pass through it would be empty —
  this is a common beginner bug.

### What you learned

- How list comprehensions combine `filter` and `map` in one line.
- How `dict.get` avoids `KeyError` for optional keys.
- Why `collections.defaultdict` is the right tool for
  accumulator patterns.
- The difference between a list and a generator expression when the
  data is iterated more than once.

## Español

### Lo que vas a construir

Un fragmento de Python que toma una lista de compras crudas,
normaliza las claves, descarta los registros incompletos y calcula
el total por cliente con una *list comprehension* y un bucle `for`
simple. Al final habrás usado literales `dict`, una *list
comprehension* con filtro `if`, `dict.get` con valor por defecto y
`collections.defaultdict`, y habrás visto el panel de resultados en
línea actualizarse mientras cambias la entrada.

### Código inicial

```python
from collections import defaultdict

purchases = [
    {"customer": "a", "amount": 12.0},
    {"customer": "b", "amount": None},
    {"customer": "a", "amount": 3.5},
    {"amount": 7.0},
    {"customer": "c", "amount": 22.0},
]

# 1. Conserva solo los registros con `customer` Y `amount` numérico.
valid = purchases  #=> reemplaza esto por una list comprehension

# 2. Suma el importe por cliente.
totals = defaultdict(float)
#=> recorre `valid` y acumula en `totals`

print(dict(totals))
```

### Paso a paso

1. **Las *list comprehensions* filtran y transforman en una línea.**
   Reemplaza el paso 1 por
   `[p for p in purchases if p.get("customer") and isinstance(p.get("amount"), (int, float))]`.
   `get` devuelve `None` cuando falta `customer` e `isinstance`
   descarta el `amount: None`. Ejecuta el archivo — el panel en
   línea muestra la lista reducida de 5 a 3 entradas.
2. **`defaultdict(float)` evita la comprobación "¿ya existe la
   clave?".** Recorre `valid` con un `for` normal y escribe
   `totals[p["customer"]] += p["amount"]`. Sin `KeyError` y sin la
   rama `if customer in totals`.
3. **Convierte a `dict` antes del `print` final.** El repr de
   `defaultdict` es ruidoso; `dict(totals)` da una salida limpia en
   una sola línea en el panel.

### Inténtalo tú

- Añade una fila con `"amount": "12"` (una cadena). La comprobación
  `isinstance` la descarta — cámbiala por `float(p["amount"])` si
  quieres conservarla.
- Cambia la última línea a
  `print(sorted(totals.items(), key=lambda kv: -kv[1]))` para
  ordenar los clientes por importe.
- Reemplaza la *list comprehension* por una expresión generadora
  (`(p for p in purchases if ...)`) y observa que `valid` se vuelve
  un iterador de un solo uso. Una segunda pasada resultaría vacía —
  un error clásico de principiante.

### Lo que aprendiste

- Cómo las *list comprehensions* combinan `filter` y `map` en una
  sola línea.
- Cómo `dict.get` evita `KeyError` para claves opcionales.
- Por qué `collections.defaultdict` es la herramienta correcta para
  patrones acumuladores.
- La diferencia entre una lista y una expresión generadora cuando
  los datos se recorren más de una vez.
