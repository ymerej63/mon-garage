# Mon Garage — suivi d'entretien de véhicules

Application web installable (PWA) pour suivre l'entretien et le contrôle technique de plusieurs véhicules.
Les données restent sur le téléphone (aucun serveur, aucun compte).

## Fonctions
- Garage multi-véhicules, voiture principale
- Fiche véhicule : immatriculation, VIN, surnom, dates, marque, modèle, motorisation, carrosserie, carburant, transmission, boîte, puissance, code moteur, usage, couleur
- Contrôle technique : dernier CT, prochain CT (calcul auto : dernier + 2 ans, ou mise en circulation + 4 ans)
- Kilométrage + moyenne mensuelle (estimation du kilométrage du jour)
- Entretiens passés ou planifiés : travaux (liste à cocher), date, km, coût, garage, commentaires
- Plan d'entretien personnalisable par véhicule (intervalles km / mois)
- Onglet « À venir » : en retard / bientôt / plus tard
- Notifications sur le téléphone + export des rappels vers le calendrier (.ics)
- Sauvegarde / import JSON, fonctionne hors ligne

## Mise en ligne sur GitHub Pages
1. Créez un dépôt sur github.com (ex. `mon-garage`), public.
2. « Add file » › « Upload files » : déposez **tout le contenu** du dossier (index.html, app.js, core.js, style.css, sw.js, manifest.json et le dossier `icons`). Validez (« Commit changes »).
3. Settings › Pages › Source : « Deploy from a branch », branche `main`, dossier `/ (root)` › Save.
4. Après 1 à 2 minutes, l'appli est à l'adresse `https://VOTRE-PSEUDO.github.io/mon-garage/`.

## Installation sur iPhone
1. Ouvrez l'adresse dans **Safari**.
2. Partager › **Sur l'écran d'accueil**.
3. Ouvrez l'appli depuis l'icône, puis Réglages › **Activer les notifications**.

## À savoir sur les notifications
- Sur iPhone (iOS 16.4 ou plus), les notifications web ne marchent que pour l'appli ajoutée à l'écran d'accueil.
- Sans serveur, l'appli vérifie les échéances **à chaque ouverture** et envoie alors la notification. Sur Android/Chrome, une vérification en arrière-plan est aussi tentée.
- Pour un rappel garanti même sans ouvrir l'appli : bouton **« Ajouter les rappels à mon calendrier »** (alertes 30 j, 7 j et la veille). Si le fichier ne s'ouvre pas depuis l'appli installée, faites-le depuis Safari.
- Étape suivante possible : un petit serveur de notifications push (le service worker gère déjà l'événement `push`).

## Mise à jour
Remplacez les fichiers sur GitHub ; l'appli récupère la nouvelle version à la prochaine ouverture avec du réseau.
Pour forcer le renouvellement du cache, changez `VERSION` dans `sw.js`.
