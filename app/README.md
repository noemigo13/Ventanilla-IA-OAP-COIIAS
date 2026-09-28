# App — Test de Madurez Digital (OAP COIIAS)

React + Vite. Cuestionario público en `/`, dashboard privado en `/dashboard`.

## Desarrollo local

```bash
npm install
cp .env.example .env      # rellena las claves, ver mas abajo
npm run dev
```

### Contra los emuladores de Firebase (sin proyecto real)

No hace falta un proyecto de Firebase real para desarrollar. Los emuladores
soportan un project id `demo-*` sin conexion a la nube:

```bash
# necesita Java 11+ instalado (el emulador de Firestore corre sobre JVM)
firebase emulators:start --only firestore,auth --project demo-oap-coiias
```

Y en `app/.env`:

```
VITE_FIREBASE_API_KEY=demo-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-oap-coiias.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-oap-coiias
VITE_FIREBASE_STORAGE_BUCKET=demo-oap-coiias.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000000000
VITE_USE_FIREBASE_EMULATOR=true
```

La UI de los emuladores queda en `http://127.0.0.1:4000`. Para crear un
usuario de prueba del dashboard (el emulador de Auth no tiene UI de alta por
email/password desde cero, se hace por API):

```bash
curl -X POST "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key" \
  -H "Content-Type: application/json" \
  -d '{"email":"tu@email.es","password":"loquesea","returnSecureToken":true}'
```

### Sin ningun Firebase configurado

Si `app/.env` no existe o le faltan claves, la app sigue funcionando (el
cuestionario se puede recorrer entero) pero avisa explicitamente — por
consola y con un banner rojo visible en la propia pagina — de que las
respuestas no se estan guardando. Es una comprobacion deliberada para que un
despliegue mal configurado en Netlify no falle en silencio.

## Tests

```bash
npm run test   # tests de firestore.rules, requieren el emulador de Firestore corriendo
```

## Build y despliegue

`npm run build` no necesita Firebase real (usa placeholders si no hay
`.env`). El despliegue en Netlify esta configurado en `netlify.toml` (raiz
del repo): `base = app`, `command = npm run build`, `publish = dist`.

### Pasar de emuladores a un proyecto de Firebase real

1. Crear el proyecto en <https://console.firebase.google.com>, habilitar
   **Firestore** (modo nativo, region `europe-west1` recomendada) y
   **Authentication > Email/Password**.
2. Registrar una "app web" dentro del proyecto (Project settings > General >
   Tus apps) para obtener los 6 valores `apiKey`, `authDomain`, `projectId`,
   `storageBucket`, `messagingSenderId`, `appId`.
3. Dar de alta al equipo en Authentication > Users.
4. Añadir el dominio de Netlify en Authentication > Settings > Authorized
   domains.
5. Poner esos 6 valores como variables de entorno del sitio en Netlify (Site
   settings > Environment), con `VITE_USE_FIREBASE_EMULATOR` sin definir o
   en `false`.
6. Desplegar las reglas de seguridad: `firebase deploy --only firestore:rules --project <id-real>`
   (ejecutar desde la raiz del repo, donde esta `firebase.json`).

## Generacion de informe con IA (Gemini)

El boton "Generar con IA" del editor de informe (`/dashboard/:id/informe`)
llama a la Netlify Function `netlify/functions/generar-informe-ia.mts`, que
usa Gemini 2.5 Flash para redactar un resumen ejecutivo, saludo, cierre y un
comentario por area, con el contexto real de las respuestas y los resumenes
de los videos recomendados. El texto generado sigue siendo editable a mano
antes de exportar a PDF; si Gemini falla o se agota la cuota gratuita, el
informe sigue funcionando con las plantillas deterministas de siempre.

La API key de Gemini vive **solo** en el entorno de la funcion, nunca en el
cliente:

1. Consigue una key gratuita en <https://aistudio.google.com/apikey>.
2. Definela como variable de entorno del sitio en Netlify: `GEMINI_API_KEY`
   (Site settings > Environment variables). No lleva prefijo `VITE_` a
   proposito.
3. Para probarlo en local hace falta `netlify dev` (no basta con `vite dev`,
   que no sirve funciones serverless): instala el Netlify CLI
   (`npm install -g netlify-cli`), pon `GEMINI_API_KEY=...` en `app/.env` y
   ejecuta `netlify dev` desde la raiz del repo.

La funcion exige un ID token de Firebase Auth valido (el mismo login del
dashboard) antes de llamar a Gemini, para que la URL de la funcion no se
pueda usar para agotar la cuota gratuita desde fuera del equipo.

Si en algun momento se ha compartido una API key de Gemini por un canal no
seguro (chat, email, etc.), revocala y genera una nueva en AI Studio antes de
usarla en produccion.
