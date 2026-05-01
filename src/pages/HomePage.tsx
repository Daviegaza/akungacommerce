import { SEO } from '@/components/shared/SEO'
import { usePageView } from '@/hooks/useAnalytics'
import { APP_NAME, APP_DESCRIPTION } from '@/lib/constants'
import { buildStructuredData } from '@/lib/seo'
import { Hero } from '@/components/home/Hero'
import { FeaturedProducts } from '@/components/home/FeaturedProducts'
import { Categories } from '@/components/home/Categories'
import { Stats } from '@/components/home/Stats'
import { Testimonials } from '@/components/home/Testimonials'
import { Newsletter } from '@/components/home/Newsletter'

export default function HomePage() {
  usePageView('Home')

  return (
    <>
      <SEO
        title={`${APP_NAME} — Premium Commerce`}
        description={APP_DESCRIPTION}
        type="website"
        structuredData={buildStructuredData({
          title: APP_NAME,
          description: APP_DESCRIPTION,
          type: 'website',
        })}
      />
      <main>
        <Hero />
        <Stats />
        <FeaturedProducts />
        <Categories />
        <Testimonials />
        <Newsletter />
      </main>
    </>
  )
}
