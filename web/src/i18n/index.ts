import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import nb from './nb.json';
import nn from './nn.json';
import en from './en.json';
import vi from './vi.json';

const stored = (localStorage.getItem('vk_lang') || 'nb') as string;

i18n.use(initReactI18next).init({
  resources: {
    nb: { translation: nb },
    nn: { translation: nn },
    en: { translation: en },
    vi: { translation: vi },
  },
  lng: ['nb', 'nn', 'en', 'vi'].includes(stored) ? stored : 'nb',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLang(lng: string) {
  if (!['nb', 'nn', 'en', 'vi'].includes(lng)) return;
  localStorage.setItem('vk_lang', lng);
  i18n.changeLanguage(lng);
}

export default i18n;
