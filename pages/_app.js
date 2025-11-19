// pages/_app.js

// Ganti semua import CSS yang mungkin ada di sini
// dan gunakan path mutlak yang dimulai dari root.
import '/styles/globals.css'; 

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
