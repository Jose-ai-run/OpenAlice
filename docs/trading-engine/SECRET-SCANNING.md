# Escaneo de secretos antes de cada push

[PROPUESTA] Procedimiento a repetir antes de cada push a cualquier
remoto (origin o un fork), para detectar secretos nuevos introducidos
por el trabajo de esta sesión antes de que lleguen a un remoto público.
No sustituye GitHub Push Protection (que corre igual del lado del
servidor) — es una verificación local previa, sobre todo el historial
de ramas, no solo el diff pendiente.

## 1. Obtener el binario verificado

Evitar instalar herramientas de terceros sin verificación. Si no hay ya
un binario `gitleaks` de confianza disponible:

1. Descargar el release oficial desde
   `https://github.com/gitleaks/gitleaks/releases` (elegir el asset
   correspondiente al SO/arquitectura, p. ej. `gitleaks_<version>_windows_x64.zip`).
2. Descargar también `gitleaks_<version>_checksums.txt` del mismo
   release.
3. Calcular el SHA256 del zip descargado y confirmar que coincide
   exactamente con la línea correspondiente en `checksums.txt` antes de
   extraer o ejecutar nada.
4. Extraer y ejecutar `gitleaks.exe version` para confirmar que
   corresponde a la versión esperada.

Preferir Docker (`docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks
detect --source=/repo ...`) cuando Docker Desktop esté disponible; el
binario descargado es el respaldo cuando no lo está.

## 2. Comando de escaneo

Desde la raíz del repo:

```
gitleaks.exe detect --source=. --log-opts="--branches" --report-format=json --report-path=report.json --exit-code=0 -v
```

- `--log-opts="--branches"`: escanea todas las refs de rama locales, no
  solo HEAD — necesario porque el trabajo de este proyecto vive en
  varias ramas `feat/*`/`docs/*` antes de llegar a `dev`/`master`.
- `--exit-code=0`: no falla el proceso aunque haya hallazgos, para poder
  inspeccionar el JSON manualmente antes de decidir qué hacer (el
  `.gitleaksignore` del repo ya filtra los hallazgos upstream
  conocidos — ver §3).
- `-v`: salida verbose en terminal además del JSON. **El JSON y la
  salida verbose pueden contener valores de secretos en texto plano si
  hay hallazgos reales** — tratar `report.json` como sensible: no
  commitearlo, no pegarlo en chat/PRs, borrarlo del scratchpad una vez
  revisado.

## 3. `.gitleaksignore`

El archivo `.gitleaksignore` en la raíz del repo contiene fingerprints
(`commit:archivo:regla:línea`, el campo `Fingerprint` de gitleaks) de
hallazgos ya investigados y clasificados como upstream preexistentes —
ver [[docs/trading-engine/AUDIT.md]] §17. Nunca contiene valores. Un
hallazgo nuevo que no esté en ese archivo debe tratarse como
potencialmente real hasta investigarlo: identificar el commit de
origen, correr `git merge-base --is-ancestor <commit> <baseline>`
contra el commit base relevante, y si NO es ancestro (es decir, vive en
un commit propio de esta línea de trabajo), detenerse y evaluarlo antes
de cualquier push — nunca agregarlo al `.gitleaksignore` solo para
silenciarlo.

## 4. Checklist antes de un push

1. Correr el comando del §2.
2. Si la salida es `no leaks found`: push permitido en cuanto a este
   control.
3. Si hay hallazgos nuevos (no cubiertos por `.gitleaksignore`):
   detenerse, clasificar cada uno por commit/archivo/línea (nunca por
   valor) y decidir con el usuario antes de continuar.
4. Borrar cualquier `report.json`/salida verbose guardada en disco una
   vez terminada la revisión.
