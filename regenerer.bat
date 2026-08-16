@echo off
REM Double-clique sur ce fichier apres avoir modifie data\cartes_maitre.xlsx.
REM Il regenere cartes.js a partir du classeur, sans avoir besoin de Claude.
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
    python generer_cartes.py
) else (
    py generer_cartes.py
)

echo.
echo -----------------------------------------------------------
echo Si tu vois "Ecrit: ...cartes.js" ci-dessus, c'est reussi.
echo Ferme cette fenetre puis recharge index.html dans le navigateur
echo (touche F5, ou fermer/rouvrir l'onglet).
echo -----------------------------------------------------------
pause
