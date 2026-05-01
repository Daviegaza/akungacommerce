import type { CategoryInfo } from '@/types'

export const APP_NAME = 'Akunga'
export const APP_DESCRIPTION = 'Premium Commerce. Redefined.'
export const APP_TAGLINE = 'Discover products that elevate your everyday life.'

export const ROUTES = {
  home: '/',
  products: '/products',
  product: (id: string) => `/products/${id}`,
  cart: '/cart',
  checkout: '/checkout',
  account: '/account',
  search: '/search',
} as const

export const NAV_LINKS = [
  { label: 'Home', href: ROUTES.home },
  { label: 'Shop', href: ROUTES.products },
  { label: 'Categories', href: `${ROUTES.products}?view=categories` },
  { label: 'Deals', href: `${ROUTES.products}?sale=true` },
] as const

export const CATEGORIES: CategoryInfo[] = [
  {
    id: 'electronics',
    name: 'Electronics',
    description: 'Cutting-edge tech for modern life',
    image: 'https://images.unsplash.com/photo-1498049794561-1e483602d2cd?w=600&q=80',
    icon: 'Laptop',
    productCount: 42,
  },
  {
    id: 'audio',
    name: 'Audio',
    description: 'Immersive sound experiences',
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80',
    icon: 'Headphones',
    productCount: 28,
  },
  {
    id: 'wearables',
    name: 'Wearables',
    description: 'Style meets smart technology',
    image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80',
    icon: 'Watch',
    productCount: 16,
  },
  {
    id: 'accessories',
    name: 'Accessories',
    description: 'Essential complements to your kit',
    image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&q=80',
    icon: 'Gem',
    productCount: 35,
  },
  {
    id: 'home',
    name: 'Home',
    description: 'Transform your living space',
    image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&q=80',
    icon: 'Home',
    productCount: 24,
  },
  {
    id: 'sports',
    name: 'Sports',
    description: 'Performance gear for every athlete',
    image: 'https://images.unsplash.com/photo-1576618148400-f45b4fc4e9ed?w=600&q=80',
    icon: 'Trophy',
    productCount: 19,
  },
]

export const SORT_OPTIONS = [
  { label: 'Featured', value: 'featured' },
  { label: 'Newest', value: 'newest' },
  { label: 'Price: Low to High', value: 'price-asc' },
  { label: 'Price: High to Low', value: 'price-desc' },
  { label: 'Top Rated', value: 'rating' },
  { label: 'Best Selling', value: 'bestselling' },
] as const

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const
export const COLORS = [
  { label: 'Black', value: '#000000' },
  { label: 'White', value: '#FFFFFF' },
  { label: 'Navy', value: '#1E3A5F' },
  { label: 'Gray', value: '#9CA3AF' },
  { label: 'Red', value: '#EF4444' },
  { label: 'Blue', value: '#3B82F6' },
  { label: 'Green', value: '#22C55E' },
] as const

export const PRICE_RANGE: [number, number] = [0, 2000]

export const SHIPPING_THRESHOLD = 75
export const STANDARD_SHIPPING = 9.99
export const TAX_RATE = 0.08
