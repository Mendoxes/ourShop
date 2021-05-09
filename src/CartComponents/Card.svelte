<script>
  import { get } from "svelte/store";
  import { cart } from "../Stores/stores.js";
  export let item;
  export let checkId = 1;
  let check = true; 
  
  let { img, name, price,id } = item;

  img = `img/${img}`;
  const cartItems = get(cart);
  let inCart = cartItems[name] ? cartItems[name].count : 0;
  function addToCart() {
    inCart++;
    cart.update(n => {
      return { ...n, [name]: { ...item, count: inCart } };
    });
  }

</script>
<style>
.card-body{text-align: center;}
.black{background-color: black;}

</style>
{#if id === checkId }
<div class="card">
  <img  class="card-img-top" width="100" src={img} alt={name} />
  <div class="card-body">
<div >Electronics</div>
  <h5 class="card-title">{name}</h5>
  

  <b class=alert alert-info >  {price} £</b>
  <p class=alert alert-info >{#if inCart > 0}
      <span>
        <em>({inCart} in cart)</em>
      </span>
    {/if}</p> </div>
  <div class="btn-group" role="group">
    <button type="button" class="btn btn-primary black" on:click={addToCart}>
      <object
        aria-label="shopping cart"
        type="image/svg+xml"
        data="img/svg/shopping-cart.svg" />
      Add to cart
    </button>
  </div>

  
</div>{/if}
