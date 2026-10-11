# Fickan

Parkeringskarta för Stockholm. Skriv en adress och se var du får parkera, vad det kostar och hur länge du får stå, tolkat från Stockholms stads lokala trafikföreskrifter.

## Funktioner

- Adressök (OpenStreetMap) eller tryck på kartan, eller använd din plats.
- Välj dag, ankomsttid och hur länge du ska stå.
- Varje gatusträcka färgas: gratis, avgift, villkor (måste flytta), förbjudet nu.
- Sortera på smart, närmast, billigast eller chans att hitta plats.
- Detaljvy med skyltarna ritade i skyltspråk, tolkning i klartext och länk till beslutet hos Transportstyrelsen.
- Boendeparkering: kryssa i dina områden så räknas avgiften bort.
- Svenska helgdagar och dag före helgdag hanteras.

"Chans" är en uppskattning. Stockholm publicerar ingen livedata om lediga gatuplatser.

## Data

- Regler: [Stockholms stad, LTF-Tolken](https://openparking.stockholm.se/Home/Parking) (`ptillaten`, `servicedagar`, `prorelsehindrad`). Kräver en gratis API-nyckel, som läggs in i appen och sparas bara i webbläsaren.
- Karta: OpenStreetMap via Leaflet.
- Adressök: OpenStreetMap Nominatim.

## Utveckla

Ingen byggprocess. Öppna med valfri statisk server, t.ex. `python3 -m http.server`.

Tester för regelmotorn: `npm test` (Node 20+).

## Att verifiera med riktig data

Formatet bygger på ett riktigt svar från tjänsten, men några fält är inte bekräftade än:

- Hur `MAX_HOURS`, `START_TIME`, `END_TIME` och `START_WEEKDAY` används på `ptillaten`.
- Tidsformatet på servicedagar (antas vara t.ex. `0` och `600`).
- Om tjänsten skickar CORS-huvuden. Annars används JSONP, som tjänsten stöder.

Detaljvyn har en ruta "Rådata från staden" för att jämföra.
