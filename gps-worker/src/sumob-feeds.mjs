/**
 * SUMOB GTFS-Realtime public endpoints registered in PBH's open-data portal.
 * Keep upstream URLs server-side only; do not construct them from user input.
 * Public feed registration: https://dados.pbh.gov.br/dataset/gtfs-rt
 */
export const SUMOB_FEEDS=Object.freeze({
  vehiclePositions: "http://realtime4.mobilibus.com/web/4ch6j/vehicle-positions?accesskey=982a57efd77a9462bf1665696fb25984",
  tripUpdates: "http://realtime4.mobilibus.com/web/4ch6j/trip-updates?accesskey=982a57efd77a9462bf1665696fb25984",
  serviceAlerts: "http://realtime4.mobilibus.com/web/4ch6j/alerts?accesskey=982a57efd77a9462bf1665696fb25984"
});
