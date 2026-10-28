import test from 'node:test';
import assert from 'node:assert/strict';
import { productPackageListingFields } from './product-shipping-package';
import { buildMercadoLivrePackageAttributes } from './mercadolivre-listing-validation';
test('shared product packaging converts kg to g without changing the dimension axes or shipping rules',()=>{
 const policy={shippingPackage:{weight:.75,width:15,height:10,length:20},freeShipping:true,feeMode:'full'};
 const fields=productPackageListingFields(policy);
 assert.deepEqual(fields,{weightGrams:'750',widthCm:'15',heightCm:'10',lengthCm:'20'});
 assert.deepEqual(buildMercadoLivrePackageAttributes({shippingMode:'me2',weightGrams:Number(fields!.weightGrams),widthCm:Number(fields!.widthCm),heightCm:Number(fields!.heightCm),lengthCm:Number(fields!.lengthCm)}),[
  {id:'SELLER_PACKAGE_LENGTH',value_name:'20 cm'},{id:'SELLER_PACKAGE_WIDTH',value_name:'15 cm'},{id:'SELLER_PACKAGE_HEIGHT',value_name:'10 cm'},{id:'SELLER_PACKAGE_WEIGHT',value_name:'750 g'},
 ]);
 assert.equal(policy.shippingPackage.weight,.75);
});
test('absent, incomplete and invalid packaging never clears the existing listing measurements',()=>{
 for(const policy of [null,{}, {shippingPackage:null},{shippingPackage:{weight:1}},{shippingPackage:{weight:0,width:15,height:10,length:20}},{shippingPackage:{weight:'750',width:15,height:10,length:20}}])assert.equal(productPackageListingFields(policy),null);
});
