import type { Category, PaymentMethod, TicketSource } from './types';

export const CATEGORIES: Category[] = ['Supermercado', 'Delivery y salidas', 'Transporte', 'Servicios', 'Salud', 'Hogar', 'Otros'];

/**
 * Color de cada categoría en la barra del presupuesto. Rumbo es casi monocromo: gris tinta, ámbar y grises,
 * distintos en luminosidad (no solo en tono) para que se distingan sin depender del color.
 */
export const CATEGORY_COLOR: Record<Category, string> = {
  Supermercado: '#111111',
  'Delivery y salidas': '#B45309',
  Transporte: '#5E6B7A',
  Servicios: '#9AA3AD',
  Salud: '#3F7D6B',
  Hogar: '#7A6A58',
  Otros: '#C7CCD1',
};

/** Subcategorías sugeridas al registrar o corregir una línea. */
export const SUBCATEGORIES: Record<Category, string[]> = {
  Supermercado: ['Almacén', 'Carnes', 'Lácteos y huevos', 'Verdulería', 'Panadería', 'Bebidas', 'Limpieza', 'Higiene'],
  'Delivery y salidas': ['Delivery', 'Almuerzo', 'Bar y café', 'Restorán'],
  Transporte: ['Ómnibus', 'Combustible', 'Taxi y apps', 'Peajes', 'Estacionamiento'],
  Servicios: ['Luz', 'Agua', 'Internet y celular', 'Gastos comunes', 'Alquiler', 'Tarjeta'],
  Salud: ['Farmacia', 'Mutualista', 'Cuidado personal'],
  Hogar: ['Ferretería', 'Bazar', 'Muebles'],
  Otros: ['Varios'],
};

/** Medios de pago en el orden en que se ofrecen al registrar. */
export const PAYMENTS: PaymentMethod[] = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Otro'];

/** Cómo se muestra el origen de un gasto ("Supermercado · Voz"). */
export const SOURCE_LABEL: Record<TicketSource, string> = {
  qr: 'QR DGI',
  papel: 'Foto',
  voz: 'Voz',
  texto: 'Teclado',
  whatsapp: 'WhatsApp',
  extracto: 'Extracto',
};

/**
 * Cómo se muestra la categoría en las listas: "Delivery y salidas" se ve como "Delivery" o "Salidas"
 * según la subcategoría, como en la propuesta.
 */
export function categoryLabel(category: Category, subcategory?: string): string {
  if (category === 'Delivery y salidas') return subcategory === 'Delivery' ? 'Delivery' : 'Salidas';
  return category;
}
