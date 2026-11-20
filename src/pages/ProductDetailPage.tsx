import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { getProductById, getRelatedProducts, getReviewsForProduct } from '@/lib/products'
import { ProductImages } from '@/components/product/ProductImages'
import { ProductInfo } from '@/components/product/ProductInfo'
import { ProductReviews } from '@/components/product/ProductReviews'
import { ProductCard } from '@/components/product/ProductCard'
import { RecentlyViewed } from '@/components/product/RecentlyViewed'
import { SEO } from '@/components/shared/SEO'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { ErrorState } from '@/components/shared/ErrorState'
import { Separator } from '@/components/ui/separator'
import { usePageView, useProductView } from '@/hooks/useAnalytics'
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed'
import { buildStructuredData } from '@/lib/seo'
import { CATEGORIES } from '@/lib/constants'

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const product = id ? getProductById(id) : undefined

  usePageView(product ? `Product: ${product.name}` : 'Product Detail')
  useProductView(product?.id, product?.name ?? '', product?.price ?? 0)
  useRecentlyViewed(id)

  if (!id) {
    return <ErrorState title="Product not found" message="No product ID was provided." />
  }

  if (!product) {
    return <ErrorState title="Product not found" message="The product you are looking for does not exist." />
  }

  const reviews = getReviewsForProduct(product.id)
  const relatedProducts = getRelatedProducts(product, 4)
  const category = CATEGORIES.find((c) => c.id === product.category)

  return (
    <>
      <SEO
        title={product.name}
        description={product.shortDescription}
        image={product.images[0]}
        type="product"
        structuredData={buildStructuredData({
          title: product.name,
          description: product.shortDescription,
          image: product.images[0],
          type: 'product',
          price: product.price,
          availability: product.inStock ? 'in_stock' : 'out_of_stock',
          rating: product.rating,
          reviewCount: product.reviewCount,
        })}
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        {/* Breadcrumb */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <Breadcrumb
            items={[
              { label: 'Products', href: '/products' },
              ...(category ? [{ label: category.name, href: `/products?category=${category.id}` }] : []),
              { label: product.name },
            ]}
          />
        </motion.div>

        {/* Product detail */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 mb-20"
        >
          <ProductImages images={product.images} name={product.name} />
          <ProductInfo product={product} />
        </motion.div>

        {/* Specifications */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-20"
        >
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white mb-6">Specifications</h2>
          <div className="rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 overflow-hidden">
            <div className="grid sm:grid-cols-2">
              {Object.entries(product.specifications).map(([key, value], i, arr) => (
                <div
                  key={key}
                  className={`flex justify-between px-6 py-4 text-sm ${i % 2 === 0 ? 'sm:border-r border-surface-100 dark:border-surface-800' : ''} ${i < arr.length - 2 ? 'border-b border-surface-100 dark:border-surface-800' : ''}`}
                >
                  <span className="text-surface-500 dark:text-surface-400">{key}</span>
                  <span className="font-semibold text-surface-900 dark:text-surface-100">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Reviews */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-20"
        >
          <ProductReviews
            reviews={reviews}
            rating={product.rating}
            reviewCount={product.reviewCount}
          />
        </motion.div>

        {/* Related products */}
        {relatedProducts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <Separator className="mb-12" />
            <h2 className="text-2xl font-bold text-surface-900 dark:text-white mb-6">You May Also Like</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {relatedProducts.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                >
                  <ProductCard product={p} />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Recently Viewed */}
        <RecentlyViewed />
      </div>
    </>
  )
}
