# Publicar el juego gratis en GitHub Pages

El juego es una web estática: GitHub Pages la sirve gratis en
`https://devhoa.github.io/pokesurvivor-vn/`. El repositorio es
<https://github.com/devhoa/pokesurvivor-vn>.

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

En uno o dos minutos estará en <https://devhoa.github.io/pokesurvivor-vn/>.
El dominio `devhoa.github.io` ya está autorizado en Firebase Authentication
y en las restricciones HTTP referrer de la API key.

## 5. Que salga en Google

1. <https://search.google.com/search-console> → **Añadir propiedad** →
   *Prefijo de la URL* → `https://jpter78.github.io/pokesurvivor/`.
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
