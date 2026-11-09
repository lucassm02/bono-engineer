import { PRODUCT_NAME } from '@gt7/shared';

export function ProductBrand() {
  return (
    <span className="product-brand" role="img" aria-label={PRODUCT_NAME}>
      <img src="/favicon.svg" width="36" height="36" alt="" />
      <span className="product-wordmark" aria-hidden="true">
        <strong>Bono</strong>
        <span>Engineer</span>
      </span>
    </span>
  );
}
