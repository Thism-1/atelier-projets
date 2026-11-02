# Atelier Projets V3 — Kit pilote de synchronisation

**Objectif de cette première étape :** créer un projet sur un appareil, l'afficher sur l'autre, ajouter une note et vérifier sa synchronisation automatique. **Cette version n'est pas un remplacement de la V2** : elle ne comporte pas encore la migration ZIP, les pièces jointes, le calendrier, la gestion détaillée des actions et budgets, les sauvegardes automatisées ou la synchronisation hors ligne.

## Préparation : ne perds pas tes données V2

1. Conserve le fichier `Atelier_Projets_V2.html` actuel.
2. Garde précieusement l'export ZIP complet créé depuis la V2 sur ton PC, sans le publier sur GitHub.
3. Utilise la V3 pilote avec des **projets et notes de test uniquement**.

## Étape 1 — Créer les tables sécurisées Supabase

1. Va sur https://supabase.com/dashboard puis ouvre **ton projet**.
2. Choisis **SQL Editor** → **New query**.
3. Ouvre `schema.sql`, copie son contenu et exécute-le avec **Run**.
4. Dans **Table Editor**, vérifie l'existence de `ap_projects` et `ap_notes`.
5. Dans **Authentication → Providers**, vérifie que l'authentification par e-mail est activée.

Le SQL crée des règles Row Level Security (RLS) : chaque utilisateur ne peut voir ou modifier que ses propres enregistrements. Il interdit l'accès anonyme à ces tables et limite les projets actifs à **5 maximum**. Pour une vraie mise en production publique, on devra aussi tester automatiquement les politiques RLS avec plusieurs utilisateurs. **N'exécute pas ce SQL sur une base ayant déjà des tables homonymes avec des données importantes.**

## Étape 2 — Copier les fichiers dans GitHub

1. Ouvre ton dépôt GitHub `atelier-projets` (celui que tu as créé).
2. Ajoute à la **racine du dépôt** tous les fichiers du kit, sauf si tu préfères conserver la documentation ailleurs. Le dossier `icons` doit garder ses deux images.
3. Dans **Settings → Pages**, choisis **Deploy from a branch**, branche `main` et dossier `/(root)` ; enregistre.
4. Le site aura normalement une adresse de type `https://TON_IDENTIFIANT.github.io/atelier-projets/` si le dépôt s'appelle `atelier-projets`. Le chemin doit correspondre EXACTEMENT à celui affiché dans GitHub Pages, y compris la casse.
5. Attends que GitHub Pages indique l'adresse publiée et teste son ouverture en HTTPS.

Tu peux éditer ou envoyer les fichiers depuis l'interface GitHub. Un dossier entier est plus simple à transférer avec GitHub Desktop ou un outil Git, mais **aucune commande Git n'est obligatoire**.

## Étape 3 — Récupérer la configuration publique Supabase

Dans Supabase :
- Ouvre **Project Settings → API Keys** (ou le panneau **Connect** de ton projet).
- Repère la **Project URL** : `https://xxxxxxxx.supabase.co`.
- Repère la **publishable key** : `sb_publishable_...`.

Dans GitHub, modifie **`config.js`** et remplace :

```js
window.ATELIER_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxx'
});
```

**La clé publishable est destinée au code client et n'est pas secrète. La sécurité est assurée par Supabase Auth + les politiques RLS.** Ne place **jamais** une clé `sb_secret_...`, `service_role`, un mot de passe ou le fichier ZIP V2 sur GitHub.

## Étape 4 — Autoriser les redirections de connexion

1. Dans Supabase, ouvre **Authentication → URL Configuration**.
2. Renseigne dans **Site URL** : `https://TON_IDENTIFIANT.github.io/atelier-projets/`.
3. Dans **Redirect URLs**, ajoute cette même adresse. Pour le pilote, autorise l'URL exacte, pas un motif générique `*`.
4. Enregistre.
5. Dans **Authentication → Providers → Email**, vérifie que l'e-mail est autorisé et que les liens de connexion fonctionnent.

Le pilote utilise **un lien de connexion envoyé par e-mail (magic link)**. Il peut créer un utilisateur à sa première connexion si les inscriptions sont autorisées. Pour un usage privé, on pourra **désactiver les nouvelles inscriptions après création du compte** ou mettre en place un accès sur invitation. Le service e-mail Supabase par défaut comporte des quotas et limitations ; pour un usage public, il faudra prévoir un service SMTP dédié.

## Étape 5 — Vérifier sur deux appareils

1. Ouvre l'URL GitHub Pages sur ton ordinateur, connecte-toi en cliquant sur le lien reçu par e-mail.
2. Crée un projet fictif, par exemple « Test synchronisation ».
3. Ouvre la même URL sur ton téléphone et connecte-toi **avec la même adresse e-mail**.
4. Le projet doit apparaître. Ajoute une note depuis le téléphone.
5. Sur le PC, la note doit être récupérée automatiquement en quelques secondes (rafraîchissement toutes les **12 secondes**, immédiatement à l'ouverture ou au retour sur la fenêtre). Le bouton « Actualiser » force la vérification.
6. Teste la limite de cinq projets actifs en essayant d'en activer un sixième.
7. Sur le PC, clique sur « Sauvegarde de test » pour récupérer un JSON *de lecture*. **Attention : ce JSON n'est pas encore une archive ZIP restaurable.**

Sur un smartphone compatible, utilise « Ajouter à l'écran d'accueil » / « Installer l'application ». Sur Windows, Chrome ou Edge permet en général d'installer depuis le menu du navigateur.

## Ce qui est réellement disponible dans ce pilote

| Fonction | État |
| --- | --- |
| Connexion e-mail | Oui |
| Créer un projet, choisir son statut, consulter son objectif | Oui |
| Ajouter / consulter des notes | Oui |
| Synchronisation PC/mobile | Oui, **en ligne**, via Supabase (vérification périodique) |
| Limite 5 projets actifs | Oui, validée côté serveur |
| Interface responsive + thèmes bleu clair / sombre | Oui |
| Application installable PWA | Ressources PWA incluses ; dépend du navigateur et de l'hébergement HTTPS |
| Export JSON de test | Oui, **sans import** |
| Import ZIP V2, photos/documents, budget, étapes/actions | Non, jalons suivants |
| Saisie / synchronisation hors ligne | Non, jalon suivant |
| Résolution des modifications concurrentes | Non, jalon suivant |
| Sauvegarde ZIP automatique sur le PC | Non, jalon suivant |

Ce pilote charge actuellement la bibliothèque Supabase depuis jsDelivr. **Il a besoin d'une connexion Internet pour démarrer sur un appareil qui ne l'a pas déjà en cache**, et ne promet pas d'exécution hors connexion. Une prochaine version utilisera une bibliothèque intégrée au déploiement et mettra en œuvre une file d'attente locale de synchronisation.

## Dépannage

- **« Configurer Supabase »** : remplis `config.js` avec URL et publishable key valides, puis actualise la page après le déploiement GitHub.
- **Connexion qui renvoie ailleurs** : revérifie `Site URL` et `Redirect URLs` avec la bonne adresse et le bon chemin GitHub Pages.
- **« permission denied » / « row-level security »** : assure-toi d'être connecté, d'avoir exécuté `schema.sql` et de ne pas avoir utilisé un autre projet Supabase dans `config.js`.
- **Pas de mail reçu** : vérifie les spams, les quotas d'envoi Supabase et la configuration du fournisseur Email.
- **Site qui montre une ancienne interface** : attends la mise à jour GitHub Pages, puis rafraîchis. Le Service Worker actualise ses ressources à la prochaine visite connectée ; actualise au besoin avec Ctrl+F5.
- **Pas de note sur l'autre appareil** : vérifie les deux comptes, la connexion et l'indicateur « À jour », puis clique « Actualiser ».

## Sécurité et évolutivité

- Ne publie que le **code** et la clé **publishable** ; jamais de sauvegardes privées, ni de clés secrètes.
- Le SQL du pilote n'autorise pas les utilisateurs anonymes à lire les projets.
- Nous ajouterons des tests automatisés RLS multi-comptes avant une diffusion publique large.
- Nous mettrons en place la migration V2 et les sauvegardes restaurables **avant d'utiliser la V3 avec des données personnelles importantes**.

Sources : [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase clés](https://supabase.com/docs/guides/getting-started/api-keys), [Supabase email OTP](https://supabase.com/docs/reference/javascript/auth-signinwithotp), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
