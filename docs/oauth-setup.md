# Configuración de Google OAuth

Este documento explica cómo configurar la autenticación con Google OAuth 2.0 para la rama `public-debate`.

## 1. Crear proyecto en Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un nuevo proyecto o selecciona uno existente
3. En el menú lateral, ve a **APIs & Services** > **Credentials**

## 2. Configurar OAuth Consent Screen

1. Click en **OAuth consent screen** en el menú lateral
2. Selecciona **External** (para usuarios fuera de tu organización)
3. Completa los campos obligatorios:
   - **App name**: Lombardi
   - **User support email**: tu email
   - **Developer contact information**: tu email
4. En **Scopes**, agrega:
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
5. En **Test users**, agrega los emails que usarás para pruebas
6. Click en **Save and Continue**

## 3. Crear credenciales OAuth 2.0

1. Ve a **Credentials** en el menú lateral
2. Click en **Create Credentials** > **OAuth client ID**
3. Selecciona **Web application**
4. Configura:
   - **Name**: Lombardi Web Client
   - **Authorized JavaScript origins**:
     - `http://localhost:3000` (desarrollo)
     - Tu URL de producción cuando despliegues
   - **Authorized redirect URIs**:
     - `http://localhost:3000/auth/google/callback` (desarrollo)
     - Tu URL de producción + `/auth/google/callback`
5. Click en **Create**
6. **¡IMPORTANTE!** Guarda el **Client ID** y **Client Secret** que aparecen

## 4. Configurar variables de entorno

1. Copia el archivo de ejemplo:
   ```bash
   cp .env.example .env
   ```

2. Edita `.env` con tus credenciales:
   ```bash
   GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=tu-client-secret
   CALLBACK_URL=http://localhost:3000/auth/google/callback
   SESSION_SECRET=genera-un-string-aleatorio-aqui
   NODE_ENV=development
   PORT=3000
   ```

3. **Genera un SESSION_SECRET aleatorio** (en terminal):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

## 5. Instalar dotenv

Para cargar las variables de entorno:

```bash
npm install dotenv
```

## 6. Modificar backend/auth.js

Agrega al inicio del archivo:

```javascript
require('dotenv').config();
```

## 7. Iniciar el servidor

```bash
node backend/server.js
```

El servidor estará disponible en `http://localhost:3000`

## 8. Probar autenticación

1. Abre `http://localhost:3000` en tu navegador
2. Click en el botón "Login con Google"
3. Selecciona tu cuenta de Google
4. Acepta los permisos
5. Deberías ser redirigido de vuelta a la app autenticado

## Troubleshooting

### Error: "redirect_uri_mismatch"
- Verifica que la URL de callback en Google Console coincida exactamente con `CALLBACK_URL` en tu `.env`
- Asegúrate de incluir el protocolo (`http://` o `https://`)

### Error: "Access blocked: This app's request is invalid"
- Tu app está en modo "Testing" en OAuth Consent Screen
- Solo los usuarios agregados en "Test users" pueden autenticarse
- Para acceso público, debes publicar la app (requiere verificación de Google)

### Error: "invalid_client"
- Verifica que `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` sean correctos
- Asegúrate de que no tengan espacios ni comillas extras

## Seguridad en Producción

Cuando despliegues a producción:

1. Cambia `NODE_ENV=production` en `.env`
2. Usa un `SESSION_SECRET` fuerte y aleatorio
3. Configura `cookie.secure = true` (requiere HTTPS)
4. Agrega tu dominio de producción a **Authorized origins** y **Redirect URIs**
5. **¡NUNCA** commitees el archivo `.env` al repositorio

## Recursos

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Passport.js Documentation](http://www.passportjs.org/docs/)
- [passport-google-oauth20](https://www.passportjs.org/packages/passport-google-oauth20/)
