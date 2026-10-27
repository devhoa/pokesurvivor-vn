/* ============ firebase-config.js — conexión con tu proyecto de Firebase ============
 * Pega aquí la configuración de tu app web de Firebase (Consola de Firebase >
 * Configuración del proyecto > Tus apps > SDK setup and configuration > Config).
 * Los pasos completos están en docs/FIREBASE.md.
 *
 * Estos datos NO son secretos: Firebase los diseña para ir en la web. Lo que
 * protege las partidas son las reglas de Firestore (firestore.rules).
 *
 * Si se pone a null, el juego funciona en modo local (sólo en el navegador).
 */
// Proyecto pokesurvivor-460d6: autenticación normal de Firebase, SIN Identity
// Platform. No actualizar a Identity Platform desde la consola.
G.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCyttF-GZmOSkCs52AITwnf62u-77Y_QH4',
  authDomain: 'pokesurvivor-460d6.firebaseapp.com',
  projectId: 'pokesurvivor-460d6',
  storageBucket: 'pokesurvivor-460d6.firebasestorage.app',
  messagingSenderId: '781207669977',
  appId: '1:781207669977:web:d7c21d5d6838577adb42c8',
  databaseURL: 'https://pokesurvivor-460d6-default-rtdb.europe-west1.firebasedatabase.app'
};

/* Ejemplo de cómo debe quedar:
G.FIREBASE_CONFIG = {
  apiKey: 'AIza...',
  authDomain: 'tu-proyecto.firebaseapp.com',
  projectId: 'tu-proyecto',
  storageBucket: 'tu-proyecto.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abc123'
};
*/
