# Backend gratuito del ranking

El navegador puede leer los rankings, pero no escribe directamente sus marcas en
Firestore. Este Worker autentica cada cuenta, comprueba los sellos de la partida
y actualiza las marcas y sus resúmenes con la cuenta de servicio de Firebase. No actives
Identity Platform ni Firebase Functions para esta función.

## Preparación única

1. En el plan gratuito de Cloudflare, despliega `worker/ranking-worker.mjs` con
   `worker/wrangler.toml`. Las rutas usan el host existente
   `ice.pokesurvivor.com`; no añadas un dominio ni TURN.
2. En Firebase, crea una cuenta de servicio para el proyecto
   `pokesurvivor-460d6` y concédele el rol **Cloud Datastore User**. No compartas
   ni subas su clave privada al repositorio.
3. En una terminal local, desde la raíz del proyecto, guarda los secretos en
   Cloudflare:

   ```sh
   npx wrangler secret put GOOGLE_CLIENT_EMAIL --config worker/wrangler.toml
   npx wrangler secret put GOOGLE_PRIVATE_KEY --config worker/wrangler.toml
   npx wrangler secret put SEAL_SECRET --config worker/wrangler.toml
   ```

   `GOOGLE_PRIVATE_KEY` es el campo `private_key` del JSON de la cuenta de
   servicio. Para `SEAL_SECRET`, genera un secreto independiente de 32 bytes
   localmente (por ejemplo, `openssl rand -hex 32`). Pega los valores sólo en la
   terminal de Wrangler, nunca en el chat ni en un archivo versionado.
4. Comprueba en Cloudflare que las tres rutas `/v1/seal`, `/v1/submit` y
   `/v1/deferred` apuntan a este Worker. Si existe otro Worker para esas rutas,
   esta versión lo sustituye para ellas.
5. Despliega desde la raíz:

   ```sh
   npx wrangler deploy --config worker/wrangler.toml
   ```

El Worker usa Firebase Authentication y Firestore REST; el uso debe permanecer
dentro de las cuotas gratuitas de ambos servicios. Las escrituras desde el
navegador siguen bloqueadas por `firestore.rules`.

## Verificación

Inicia sesión en el juego publicado, termina una partida de al menos dos minutos
y abre el ranking. Si el backend rechaza la marca, el juego muestra el error en
vez de descartarlo silenciosamente. Las marcas anteriores que estuvieran
pendientes se envían al empezar una partida nueva.
