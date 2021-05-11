<script>
	import CardWrapper from "./CartComponents/CardWrapper.svelte";
	import CardWrapper2 from "./CartComponents/CardWrapper2.svelte";
	import Navbar from "./CartComponents/Navbar.svelte";
	import Checkout from "./CartComponents/Checkout.svelte";

	let nav = "home";
	function navHandler(event) {
	  nav = event.detail.option;
	}
  </script>
  
  <Navbar on:nav={navHandler} />
  {#if nav === 'home'}
	<CardWrapper />
  {:else if nav === "checkout"}
	<Checkout />
	{:else if nav === "cd2"}
	<CardWrapper2 />
  {/if}
