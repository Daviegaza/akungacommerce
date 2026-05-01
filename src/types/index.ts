export interface Product {
  id: string
  name: string
  slug: string
  description: string
  shortDescription: string
  price: number
  compareAtPrice: number | null
  images: string[]
  category: Category
  tags: string[]
  rating: number
  reviewCount: number
  inStock: boolean
  stockCount: number
  colors: ProductColor[]
  sizes: string[]
  features: string[]
  specifications: Record<string, string>
  createdAt: string
  isFeatured: boolean
  isNewArrival: boolean
}

export interface ProductColor {
  name: string
  hex: string
}

export type Category = 'electronics' | 'audio' | 'wearables' | 'accessories' | 'home' | 'sports'

export interface CategoryInfo {
  id: Category
  name: string
  description: string
  image: string
  icon: string
  productCount: number
}

export interface Review {
  id: string
  productId: string
  userId: string
  userName: string
  userAvatar: string
  rating: number
  title: string
  comment: string
  createdAt: string
  isVerified: boolean
}

export interface CartItem {
  id: string
  productId: string
  name: string
  image: string
  price: number
  color: string
  size: string
  quantity: number
}

export interface CartState {
  items: CartItem[]
  isOpen: boolean
}

export interface User {
  id: string
  name: string
  email: string
  avatar: string
  orders: Order[]
  addresses: Address[]
  wishlist: string[]
  createdAt: string
}

export interface Order {
  id: string
  date: string
  status: 'processing' | 'shipped' | 'delivered' | 'cancelled'
  total: number
  items: CartItem[]
  trackingNumber: string | null
}

export interface Address {
  id: string
  label: string
  street: string
  city: string
  state: string
  zip: string
  country: string
  isDefault: boolean
}

export interface CheckoutFormData {
  email: string
  firstName: string
  lastName: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  cardNumber: string
  cardExpiry: string
  cardCvc: string
  cardName: string
}

export type SortOption = 'featured' | 'newest' | 'price-asc' | 'price-desc' | 'rating' | 'bestselling'

export interface FilterState {
  categories: Category[]
  priceRange: [number, number]
  sizes: string[]
  colors: string[]
  inStockOnly: boolean
  onSale: boolean
  rating: number | null
}

export interface SearchResult {
  products: Product[]
  query: string
  suggestions: string[]
}
