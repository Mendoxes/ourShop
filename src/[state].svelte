<script context="module" lang="ts">
    export async function load({ page }) {
      return {
        props: {
          state: page.params.state
        },
      };
    }
  </script>


<script>

export let state;
</script>

<h1> {state}</h1>