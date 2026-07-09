import { fetchProducts } from "../api/client";
import Image from "next/image";

export default async function Home() {
  let products = [];
  try {
    products = await fetchProducts();
  } catch (error) {
    console.error(error);
  }

  return (
    <div>
      <section className="hero-section">
        <h1 className="hero-title">Redefining the <br />Modern Workspace.</h1>
        <p className="hero-subtitle">
          Explore our exclusive collection of premium ergonomic furniture designed 
          for both absolute comfort and uncompromising aesthetic brilliance.
        </p>
      </section>

      <section className="product-grid">
        {products.length === 0 ? (
          <div className="loading-state">
            <p>Loading showroom...</p>
          </div>
        ) : (
          products.map((product: any) => (
            <div key={product.id} className="product-card">
              <div className="product-image-container">
                🪑
              </div>
              <div className="product-info">
                <div className="product-category">Premium Seating</div>
                <h3 className="product-name">{product.name}</h3>
                <div className="product-price">
                  ${Number(product.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <button className="add-to-cart-btn">
                  Add to Cart
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
