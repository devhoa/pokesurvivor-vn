# Publicar el juego gratis en GitHub Pages

El juego es una web estática: GitHub Pages la sirve gratis en
`https://trinhhoa1701-ctrl.github.io/pokesurvivor-vn/`. El repositorio es
<https://github.com/trinhhoa1701-ctrl/pokesurvivor-vn>.

## 1. Subir cambios

Desde la carpeta del proyecto:

```
git add -A
git commit -m "Describe el cambio"
git push origin main
```

## 2. Activar GitHub Pages

En el repositorio: **Settings → Pages** →
*Source*: **Deploy from a branch** → *Branch*: **main**, carpeta **/ (root)** → **Save**.

En uno o dos minutos estará en
<https://trinhhoa1701-ctrl.github.io/pokesurvivor-vn/>.
Antes de usar Google u otros inicios de sesión, añade `trinhhoa1701-ctrl.github.io`
a los dominios autorizados de Firebase Authentication y
`https://trinhhoa1701-ctrl.github.io/*` a las restricciones HTTP referrer de la
API key.

## 3. Que salga en Google

1. <https://search.google.com/search-console> → **Añadir propiedad** →
   *Prefijo de la URL* →
   `https://trinhhoa1701-ctrl.github.io/pokesurvivor-vn/`.
2. Verificación: el método **Etiqueta HTML** te da una línea `<meta ...>`;
   pégala dentro de `<head>` en `index.html`, haz `git push`, y pulsa Verificar.
3. **Inspección de URLs** → pega la dirección → **Solicitar indexación**.

Google tarda de días a semanas en mostrarlo, y al principio sólo aparece si se
busca el nombre exacto.

## Actualizar el juego más adelante

Cada vez que cambies algo:

```
git add -A
git commit -m "Qué has cambiado"
git push
```

GitHub Pages se actualiza solo en uno o dos minutos.

## Recordatorios

- **Nada de dinero**: ni anuncios, ni donaciones a cambio de nada, ni pagos.
  Lo exige la licencia de los sprites (CC BY-NC) y es lo que más reduce el
  riesgo de que Nintendo pida retirarlo.
- Si llega una reclamación de derechos al correo del aviso legal, atiéndela
  rápido: retirar lo que pidan suele cerrar el asunto.
