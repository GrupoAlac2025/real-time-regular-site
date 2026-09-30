# Real Time Regular — Real Time Ad

Ad vertical/horizontal para pantallas digitales, generada con el Builder de Real Time Ads.

## Estructura

```
real-time-regular/
├── index.html        ← Página principal del aviso
├── css/style.css     ← Estilos, fuentes y media queries
├── js/config.js      ← Configuración del aviso (fechas, textos, clima, etc.)
├── js/ad.js          ← Motor del aviso (no modificar)
└── assets/           ← Fondos, videos, imágenes y fuentes
```

## Desplegar en GitHub Pages

1. Sube el contenido de esta carpeta a un repositorio de GitHub (por ejemplo `nombre-cliente-real-time`).
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main → / (root)**.
3. En unos minutos quedará disponible en `https://<usuario>.github.io/<repositorio>/`.
4. En la URL final debes apuntar a `index.html` (GitHub Pages la sirve por defecto).

> El sistema de reproducción carga el aviso dentro de un `iframe` y lo estira a pantalla completa. El aviso está diseñado en base `768×384` y se ajusta solo a cualquier resolución.

## Cambiar configuraciones rápidas

Todos los valores (cuenta regresiva, mensajes, clima, horario de aparición, posiciones por tamaño de pantalla) se encuentran en `js/config.js`.
