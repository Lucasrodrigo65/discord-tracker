# 🎙️ Discord Voice Tracker

Trackea cuántas horas pasa cada miembro de tu servidor de Discord conectado en canales de voz. Muestra un ranking mensual y semanal en una página web hosteable en Netlify.

## 📁 Estructura del proyecto

```
discord-tracker/
├── bot/                    # Bot de Discord (Node.js)
│   ├── index.js            # Código principal del bot
│   ├── package.json
│   └── .env.example        # Template de variables de entorno
├── web/                    # Frontend React (deployable en Netlify)
│   ├── src/
│   │   ├── App.jsx         # Componente principal con ranking
│   │   ├── App.css         # Estilos dark mode
│   │   └── supabaseClient.js
│   ├── netlify.toml
│   └── .env.example
└── supabase_schema.sql     # Schema de base de datos (ejecutar en Supabase)
```

## 🚀 Configuración paso a paso

### 1. Crear el proyecto en Supabase

1. Ir a [supabase.com](https://supabase.com) y crear una cuenta gratuita
2. Crear un nuevo proyecto
3. Ir a **SQL Editor** y ejecutar todo el contenido de [`supabase_schema.sql`](./supabase_schema.sql)
4. Guardar la **URL del proyecto** y la **anon key** (están en `Settings > API`)

> **Importante:** El bot necesita el **service_role key** (no el anon key) para poder escribir en la base de datos. Usá el anon key solo para el frontend web.

### 2. Crear el bot de Discord

1. Ir al [Discord Developer Portal](https://discord.com/developers/applications)
2. Clic en **New Application** → ponele un nombre (ej: "Voice Tracker")
3. Ir a la sección **Bot** → clic en **Add Bot**
4. Copiar el **Token** (guardarlo, solo se muestra una vez)
5. En **Privileged Gateway Intents**, activar:
   - ✅ Server Members Intent
   - ✅ Voice States (viene activado por defecto)
6. Ir a **OAuth2 > URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `View Channels`, `Connect`, `Send Messages`, `Embed Links`
7. Abrir el link generado e invitar el bot a tu servidor

### 3. Obtener IDs de Discord

Para obtener IDs en Discord: activar **Modo Desarrollador** en `Ajustes > Avanzado`.
Luego hacés clic derecho en el servidor/canal y copiás el ID.

- **Guild ID**: clic derecho en el servidor
- **Channel ID** (ranking automático): clic derecho en el canal de texto donde querés que postee

### 4. Configurar el bot

```bash
cd bot
cp .env.example .env
```

Editar `.env`:
```env
DISCORD_TOKEN=tu_token_del_bot
GUILD_ID=id_de_tu_servidor
IGNORED_CHANNELS=id_canal_afk,id_otro_canal  # opcional
RANKING_CHANNEL_ID=id_canal_donde_postear     # opcional
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=tu_service_role_key              # ¡service_role, no anon!
```

### 5. Correr el bot

```bash
cd bot
npm start
```

El bot va a:
- Registrar los slash commands `/ranking` y `/misporas`
- Empezar a trackear entradas/salidas de canales de voz
- Postear el ranking automáticamente el último día del mes

### 6. Configurar el frontend web

```bash
cd web
cp .env.example .env
```

Editar `.env`:
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=tu_anon_key          # anon key (pública, lectura)
VITE_SERVER_NAME=Nombre de tu servidor
```

Probar localmente:
```bash
npm install
npm run dev
```

### 7. Deploy en Netlify

1. Ir a [netlify.com](https://netlify.com) y crear cuenta gratuita
2. Conectar con GitHub (subir el proyecto primero) **o** usar Netlify Drop
3. **Build settings:**
   - Base directory: `web`
   - Build command: `npm run build`
   - Publish directory: `web/dist`
4. En **Site configuration > Environment variables**, agregar las variables de `.env`
5. ¡Deploy! 🎉

## 🤖 Comandos del bot

| Comando | Descripción |
|---------|-------------|
| `/ranking` | Muestra el top 10 del mes (o semana) |
| `/ranking periodo:Esta semana` | Ranking de los últimos 7 días |
| `/misporas` | Muestra tus propias horas (solo vos lo ves) |

## 🌐 Features de la web

- 🏆 **Podio visual** para los top 3
- 📊 **Barra de progreso** relativa al líder
- 🔄 **Auto-refresh** cada 2 minutos
- 📅 Toggle entre ranking **mensual** y **semanal**
- 🌙 **Dark mode** estilo Discord
- 📱 Responsive para mobile

## 🔧 Dónde correr el bot

El bot necesita estar corriendo 24/7 para registrar todas las sesiones. Opciones gratuitas:

- **[Railway](https://railway.app)** - 500 horas gratis/mes (recomendado)
- **[Render](https://render.com)** - Plan gratuito con sleep
- **VPS propio** - Si tienen algún servidor o PC siempre prendida

Para Railway: subir el proyecto, conectar el repo, agregar las variables de entorno, listo.
