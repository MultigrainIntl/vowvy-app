import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

i18next
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'pt-BR'],
    nonExplicitSupportedLngs: true,
    ns: ['translation'],
    defaultNS: 'translation',
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json?v=20260824-shared-inventory',
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'vowvy-lang',
      // Normalize any 'pt' or 'pt-PT' variant to 'pt-BR' so the load path
      // always resolves to /locales/pt-BR/translation.json. Without this,
      // nonExplicitSupportedLngs passes 'pt' as supported but Firebase Hosting
      // returns the SPA index.html (HTTP 200 HTML) for the missing /locales/pt/
      // path, causing silent parse failure and English fallback.
      convertDetectedLanguage: (lng: string) => lng.startsWith('pt') ? 'pt-BR' : lng,
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18next;
