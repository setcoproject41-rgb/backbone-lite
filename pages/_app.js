// pages/_app.js
import '@/styles/globals.css'; // Ganti jika Anda tidak menggunakan globals.css

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
