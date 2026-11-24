import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Queen of Clean LV",
    short_name: "Queen of Clean",
    description: "Home cleaning across the Las Vegas Valley.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f3",
    theme_color: "#faf8f3",
    icons: [
      { src: "/images/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/images/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
