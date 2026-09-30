window.ALAD_CONFIG = {
  "stageWidth": 768,
  "stageHeight": 384,
  "fitMode": "cover",
  "bgColor": "#000000",
  "transition": 0.8,
  "backgroundFade": true,
  "clockTimezone": "America/Lima",
  "projectId": "p_muokdpdlo8gehu",
  "backgrounds": [
    {
      "id": "b_muoke1r3h37153",
      "type": "video",
      "src": "https://storage.googleapis.com/media_files_contents_qa/realtime/p_muokdpdlo8gehu/1790800639796_halls_pantalla_768x384_plantilla.mp4",
      "duration": 8,
      "breakpoints": null,
      "condition": null
    }
  ],
  "resources": [
    {
      "id": "r_muoke6tflrnw0p",
      "type": "weather",
      "lat": -12.0464,
      "lon": -77.0428,
      "city": "Lima",
      "unit": "celsius",
      "tokenPrefix": "lima"
    }
  ],
  "weather": {
    "enabled": true,
    "lat": -12.0464,
    "lon": -77.0428,
    "city": "Lima",
    "unit": "celsius",
    "refresh": 15
  },
  "apiRefreshMin": 1,
  "breakpoints": [],
  "elements": [
    {
      "id": "e_muokeguflnywfj",
      "resourceId": "",
      "type": "weather",
      "enabled": true,
      "x": 10.5,
      "y": 4.4,
      "width": 48.8,
      "height": 21.5,
      "align": "center",
      "zIndex": 2,
      "fontSize": 59,
      "fontWeight": "700",
      "color": "#ffffff",
      "background": "transparent",
      "padding": "10px 24px",
      "radius": "10px",
      "letterSpacing": 0,
      "lineHeight": 1.2,
      "fontFamilyKey": "Anton-Regular",
      "fitText": false,
      "condition": {
        "type": "always"
      },
      "overrides": {},
      "showWeatherIcon": false,
      "showWeatherTemp": true,
      "showWeatherCity": false,
      "showWeatherCondition": false
    },
    {
      "id": "e_muokehb1l7a9is",
      "resourceId": "",
      "type": "text",
      "enabled": true,
      "x": -5,
      "y": 5.4,
      "width": 48.8,
      "height": 21.5,
      "align": "center",
      "zIndex": 2,
      "fontSize": 59,
      "fontWeight": "700",
      "color": "#ffffff",
      "background": "transparent",
      "padding": "10px 24px",
      "radius": "10px",
      "letterSpacing": 0,
      "lineHeight": 1.2,
      "fontFamilyKey": "Anton-Regular",
      "fitText": false,
      "condition": {
        "type": "always"
      },
      "overrides": {},
      "text": "LIMA"
    }
  ]
};
