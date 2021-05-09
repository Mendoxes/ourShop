<script>
    import Card from "./Card.svelte";
    import items from "../itemsSecond.js";
    
  </script>
  
  <div class="container">
    {items}
    <div class="row">
    

      {#each items as item}
      
      <div class="col-md-4">

      <Card {item} /> 
    </div>
  
    {/each} 
   </div> </div>  