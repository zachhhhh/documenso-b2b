import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

// Supported languages
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
];

// Default language
export const DEFAULT_LANGUAGE = 'en';

// Language namespaces
export const NAMESPACES = ['common', 'auth', 'documents', 'forms', 'settings'];

/**
 * Initialize i18next for the client.
 */
export const initI18next = async (lng = DEFAULT_LANGUAGE) => {
  const i18nInstance = createInstance();
  
  await i18nInstance
    .use(Backend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      lng,
      fallbackLng: DEFAULT_LANGUAGE,
      ns: NAMESPACES,
      defaultNS: 'common',
      debug: process.env.NODE_ENV === 'development',
      interpolation: {
        escapeValue: false, // React already escapes values
      },
      react: {
        useSuspense: false,
      },
      backend: {
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
      detection: {
        order: ['cookie', 'localStorage', 'navigator', 'htmlTag'],
        caches: ['cookie', 'localStorage'],
      },
    });
  
  return i18nInstance;
};

/**
 * Get translation function for server-side rendering.
 */
export const getServerTranslation = async (lng = DEFAULT_LANGUAGE, ns = 'common') => {
  const i18nInstance = createInstance();
  
  await i18nInstance.use(initReactI18next).init({
    lng,
    fallbackLng: DEFAULT_LANGUAGE,
    ns,
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
    resources: await loadServerTranslations(lng, Array.isArray(ns) ? ns : [ns]),
  });
  
  return i18nInstance.getFixedT(lng, ns);
};

/**
 * Load translations for server-side rendering.
 */
const loadServerTranslations = async (lng: string, namespaces: string[]) => {
  const resources: Record<string, Record<string, any>> = {};
  
  for (const ns of namespaces) {
    try {
      // In a real implementation, you would load these from files or a database
      const translations = await import(`../../../public/locales/${lng}/${ns}.json`);
      
      if (!resources[lng]) {
        resources[lng] = {};
      }
      
      resources[lng][ns] = translations.default;
    } catch (error) {
      console.error(`Failed to load translations for ${lng}/${ns}:`, error);
      
      // Fallback to English
      if (lng !== DEFAULT_LANGUAGE) {
        try {
          const fallbackTranslations = await import(`../../../public/locales/${DEFAULT_LANGUAGE}/${ns}.json`);
          
          if (!resources[lng]) {
            resources[lng] = {};
          }
          
          resources[lng][ns] = fallbackTranslations.default;
        } catch (fallbackError) {
          console.error(`Failed to load fallback translations for ${DEFAULT_LANGUAGE}/${ns}:`, fallbackError);
          resources[lng][ns] = {};
        }
      } else {
        resources[lng][ns] = {};
      }
    }
  }
  
  return resources;
};

/**
 * Format a date according to the user's locale.
 */
export const formatDate = (date: Date | string, locale = DEFAULT_LANGUAGE, options?: Intl.DateTimeFormatOptions) => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...options,
  }).format(dateObj);
};

/**
 * Format a number according to the user's locale.
 */
export const formatNumber = (number: number, locale = DEFAULT_LANGUAGE, options?: Intl.NumberFormatOptions) => {
  return new Intl.NumberFormat(locale, options).format(number);
};

/**
 * Format a currency amount according to the user's locale.
 */
export const formatCurrency = (amount: number, currency = 'USD', locale = DEFAULT_LANGUAGE) => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
};
