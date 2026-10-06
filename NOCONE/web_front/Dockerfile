# ---- Etapa 1: Build de React/Vite/CRA ----
FROM node:18-alpine AS builder
WORKDIR /app

# Copiamos package.json y lock primero para cachear dependencias
COPY package*.json ./


# Si usas pnpm/yarn, adapta los 2 comandos siguientes:
RUN npm ci

# Copiamos el resto del proyecto
COPY . .

# Compilamos a producción -> genera carpeta /app/build
# Si usas Vite, el comando suele ser "npm run build" y la salida es /dist.
# Para CRA (create-react-app) la salida es /build (por defecto).
RUN npm run build

# ---- Etapa 2: Nginx estático ----
FROM nginx:stable-alpine
# Carpeta estática de Nginx
WORKDIR /usr/share/nginx/html

# Copiamos el resultado del build al docroot
# Si tu bundler genera "dist/" en lugar de "build/", cambia la ruta de origen
COPY --from=builder /app/build/ /usr/share/nginx/html/

# ⚠️ NUEVO: copiamos los videos desde public/videos a /usr/share/nginx/html/videos
RUN mkdir -p /usr/share/nginx/html/videos
COPY public/videos/ /usr/share/nginx/html/videos/

# Copiar videos reales
COPY public/videos ./videos

# Copiar modelos ONNX
COPY public/models ./models

# Si tienes un config.js que quieres sobreescribir en runtime, puedes copiarlo aparte:
# Crea la carpeta js y copia config.js (runtime editable si montas volumen)
RUN mkdir -p js
COPY public/js/config.js js/config.js

# Virtual host con fallback SPA
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
