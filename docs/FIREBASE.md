# Firebase

El proyecto activo es `pokesurvivor-460d6`, configurado en `.firebaserc` y
`js/core/firebase-config.js`. La app web registrada es **PokeSurvivor Web**.
El proyecto se creó sin Google Analytics y sigue en el plan gratuito Spark.
No actualizar Firebase Authentication a Identity Platform.

## Acceso

- Authentication: Google y Email/Password habilitados.
- Dominios autorizados: `localhost`, `127.0.0.1`, `pokesurvivor.com`,
  `www.pokesurvivor.com`, `jpter78.github.io` y `devhoa.github.io`.
- Restricciones HTTP referrer de la API key del navegador: deben permitir
  `http://127.0.0.1:8000/*`, `https://jpter78.github.io/*`,
  `https://devhoa.github.io/*`,
  `https://pokesurvivor.com/*`, `https://www.pokesurvivor.com/*` y
  `https://pokesurvivor-460d6.firebaseapp.com/*`. Este último dominio es
  necesario porque Firebase Authentication lo usa durante el inicio de sesión
  con Google. Si se cambia `authDomain` o el origen local, actualizar también
  esta lista en Google Cloud Console.
- Para GitHub Pages de `trinhhoa1701-ctrl/pokesurvivor-vn`, añadir
  `trinhhoa1701-ctrl.github.io` a los dominios autorizados y
  `https://trinhhoa1701-ctrl.github.io/*` a las restricciones HTTP referrer.
  Pendiente: la cuenta de Google activa no tiene acceso al proyecto para hacer
  este cambio.
- Cloud Firestore: base predeterminada en `eur3` (Europa).
- Realtime Database: `europe-west1` (Bélgica).

La configuración web de Firebase no es un secreto. Las reglas de Firestore
permiten a cada usuario acceder a su propia partida y perfil, reservar su
propio apodo y leer el ranking con sesión iniciada. Las solicitudes de amistad
sólo son visibles para sus dos participantes; el remitente puede crear una
solicitud pendiente, el destinatario aceptarla y cualquiera de los dos
eliminarla. Las escrituras del ranking siguen denegadas hasta tener validación
de marcas en servidor. El resto de colecciones queda denegado. Realtime
Database también está en modo cerrado, por lo que las salas y partidas
cooperativas no están disponibles en este proyecto.

Para publicar las reglas versionadas en el repositorio, desde la raíz:

```sh
firebase deploy --only firestore:rules,database
```

El proyecto nuevo empieza sin las cuentas ni los datos cloud del proyecto
anterior; no se ha hecho una migración de esos datos.
