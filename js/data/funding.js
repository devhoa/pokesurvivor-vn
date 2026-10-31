/* ============ funding.js — donaciones ============
 * Las donaciones son voluntarias, no dan ninguna ventaja en el juego y se
 * se usan sólo para mantenerlo en línea: servidores y alojamiento web.
 * Este archivo es la fuente de lo que se enseña en el juego (botón "Apoyar")
 * y en la página /apoyar/. Se actualiza a mano:
 *
 *   kofi      usuario de Ko-fi (vacío = el botón no sale)
 *   sponsors  usuario de GitHub Sponsors (para quien entra al repositorio)
 *   costs     gastos [concepto, euros al mes]; si el coste no es fijo, un texto
 */
G.Funding = {
  kofi: 'jpter78',
  sponsors: 'JPTER78',
  costs: [
    ['Servidores (partidas, cuentas, ranking y multijugador)', 'Según cuánta gente juegue'],
    ['Alojamiento web (GitHub Pages)', 'Gratis']
  ],
  get url() { return this.kofi ? 'https://ko-fi.com/' + this.kofi : ''; }
};
