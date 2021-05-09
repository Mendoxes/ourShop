var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function subscribe(store, ...callbacks) {
        if (store == null) {
            return noop;
        }
        const unsub = store.subscribe(...callbacks);
        return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
    }
    function get_store_value(store) {
        let value;
        subscribe(store, _ => value = _)();
        return value;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function outro_and_destroy_block(block, lookup) {
        transition_out(block, 1, 1, () => {
            lookup.delete(block.key);
        });
    }
    function update_keyed_each(old_blocks, dirty, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
        let o = old_blocks.length;
        let n = list.length;
        let i = o;
        const old_indexes = {};
        while (i--)
            old_indexes[old_blocks[i].key] = i;
        const new_blocks = [];
        const new_lookup = new Map();
        const deltas = new Map();
        i = n;
        while (i--) {
            const child_ctx = get_context(ctx, list, i);
            const key = get_key(child_ctx);
            let block = lookup.get(key);
            if (!block) {
                block = create_each_block(key, child_ctx);
                block.c();
            }
            else if (dynamic) {
                block.p(child_ctx, dirty);
            }
            new_lookup.set(key, new_blocks[i] = block);
            if (key in old_indexes)
                deltas.set(key, Math.abs(i - old_indexes[key]));
        }
        const will_move = new Set();
        const did_move = new Set();
        function insert(block) {
            transition_in(block, 1);
            block.m(node, next);
            lookup.set(block.key, block);
            next = block.first;
            n--;
        }
        while (o && n) {
            const new_block = new_blocks[n - 1];
            const old_block = old_blocks[o - 1];
            const new_key = new_block.key;
            const old_key = old_block.key;
            if (new_block === old_block) {
                // do nothing
                next = new_block.first;
                o--;
                n--;
            }
            else if (!new_lookup.has(old_key)) {
                // remove old block
                destroy(old_block, lookup);
                o--;
            }
            else if (!lookup.has(new_key) || will_move.has(new_key)) {
                insert(new_block);
            }
            else if (did_move.has(old_key)) {
                o--;
            }
            else if (deltas.get(new_key) > deltas.get(old_key)) {
                did_move.add(new_key);
                insert(new_block);
            }
            else {
                will_move.add(old_key);
                o--;
            }
        }
        while (o--) {
            const old_block = old_blocks[o];
            if (!new_lookup.has(old_block.key))
                destroy(old_block, lookup);
        }
        while (n)
            insert(new_blocks[n - 1]);
        return new_blocks;
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : options.context || []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    const subscriber_queue = [];
    /**
     * Create a `Writable` store that allows both updating and reading by subscription.
     * @param {*=}value initial value
     * @param {StartStopNotifier=}start start and stop notifications for subscriptions
     */
    function writable(value, start = noop) {
        let stop;
        const subscribers = [];
        function set(new_value) {
            if (safe_not_equal(value, new_value)) {
                value = new_value;
                if (stop) { // store is ready
                    const run_queue = !subscriber_queue.length;
                    for (let i = 0; i < subscribers.length; i += 1) {
                        const s = subscribers[i];
                        s[1]();
                        subscriber_queue.push(s, value);
                    }
                    if (run_queue) {
                        for (let i = 0; i < subscriber_queue.length; i += 2) {
                            subscriber_queue[i][0](subscriber_queue[i + 1]);
                        }
                        subscriber_queue.length = 0;
                    }
                }
            }
        }
        function update(fn) {
            set(fn(value));
        }
        function subscribe(run, invalidate = noop) {
            const subscriber = [run, invalidate];
            subscribers.push(subscriber);
            if (subscribers.length === 1) {
                stop = start(set) || noop;
            }
            run(value);
            return () => {
                const index = subscribers.indexOf(subscriber);
                if (index !== -1) {
                    subscribers.splice(index, 1);
                }
                if (subscribers.length === 0) {
                    stop();
                    stop = null;
                }
            };
        }
        return { set, update, subscribe };
    }

    const cart = writable({});

    /* src\CartComponents\Card.svelte generated by Svelte v3.38.2 */

    function create_if_block$3(ctx) {
    	let div3;
    	let img_1;
    	let img_1_src_value;
    	let t0;
    	let div1;
    	let div0;
    	let t2;
    	let h5;
    	let t4;
    	let b;
    	let t7;
    	let p;
    	let t8;
    	let div2;
    	let button;
    	let mounted;
    	let dispose;
    	let if_block = /*inCart*/ ctx[2] > 0 && create_if_block_1$1(ctx);

    	return {
    		c() {
    			div3 = element("div");
    			img_1 = element("img");
    			t0 = space();
    			div1 = element("div");
    			div0 = element("div");
    			div0.textContent = "Electronics";
    			t2 = space();
    			h5 = element("h5");
    			h5.textContent = `${/*name*/ ctx[3]}`;
    			t4 = space();
    			b = element("b");
    			b.textContent = `${/*price*/ ctx[4]} £`;
    			t7 = space();
    			p = element("p");
    			if (if_block) if_block.c();
    			t8 = space();
    			div2 = element("div");
    			button = element("button");

    			button.innerHTML = `<object aria-label="shopping cart" type="image/svg+xml" data="img/svg/shopping-cart.svg"></object>
      Add to cart`;

    			attr(img_1, "class", "card-img-top");
    			attr(img_1, "width", "100");
    			if (img_1.src !== (img_1_src_value = /*img*/ ctx[1])) attr(img_1, "src", img_1_src_value);
    			attr(img_1, "alt", /*name*/ ctx[3]);
    			attr(h5, "class", "card-title");
    			attr(b, "class", "alert");
    			attr(b, "alert-info", "");
    			attr(p, "class", "alert");
    			attr(p, "alert-info", "");
    			attr(div1, "class", "card-body svelte-nvfl80");
    			attr(button, "type", "button");
    			attr(button, "class", "btn btn-primary black svelte-nvfl80");
    			attr(div2, "class", "btn-group");
    			attr(div2, "role", "group");
    			attr(div3, "class", "card");
    		},
    		m(target, anchor) {
    			insert(target, div3, anchor);
    			append(div3, img_1);
    			append(div3, t0);
    			append(div3, div1);
    			append(div1, div0);
    			append(div1, t2);
    			append(div1, h5);
    			append(div1, t4);
    			append(div1, b);
    			append(div1, t7);
    			append(div1, p);
    			if (if_block) if_block.m(p, null);
    			append(div3, t8);
    			append(div3, div2);
    			append(div2, button);

    			if (!mounted) {
    				dispose = listen(button, "click", /*addToCart*/ ctx[6]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*img*/ 2 && img_1.src !== (img_1_src_value = /*img*/ ctx[1])) {
    				attr(img_1, "src", img_1_src_value);
    			}

    			if (/*inCart*/ ctx[2] > 0) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_1$1(ctx);
    					if_block.c();
    					if_block.m(p, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div3);
    			if (if_block) if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (35:29) {#if inCart > 0}
    function create_if_block_1$1(ctx) {
    	let span;
    	let em;
    	let t0;
    	let t1;
    	let t2;

    	return {
    		c() {
    			span = element("span");
    			em = element("em");
    			t0 = text("(");
    			t1 = text(/*inCart*/ ctx[2]);
    			t2 = text(" in cart)");
    		},
    		m(target, anchor) {
    			insert(target, span, anchor);
    			append(span, em);
    			append(em, t0);
    			append(em, t1);
    			append(em, t2);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*inCart*/ 4) set_data(t1, /*inCart*/ ctx[2]);
    		},
    		d(detaching) {
    			if (detaching) detach(span);
    		}
    	};
    }

    function create_fragment$5(ctx) {
    	let if_block_anchor;
    	let if_block = /*id*/ ctx[5] === /*checkId*/ ctx[0] && create_if_block$3(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, [dirty]) {
    			if (/*id*/ ctx[5] === /*checkId*/ ctx[0]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block$3(ctx);
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance$4($$self, $$props, $$invalidate) {
    	let { item } = $$props;
    	let { checkId = 1 } = $$props;
    	let { img, name, price, id } = item;
    	img = `img/${img}`;
    	const cartItems = get_store_value(cart);
    	let inCart = cartItems[name] ? cartItems[name].count : 0;

    	function addToCart() {
    		$$invalidate(2, inCart++, inCart);

    		cart.update(n => {
    			return { ...n, [name]: { ...item, count: inCart } };
    		});
    	}

    	$$self.$$set = $$props => {
    		if ("item" in $$props) $$invalidate(7, item = $$props.item);
    		if ("checkId" in $$props) $$invalidate(0, checkId = $$props.checkId);
    	};

    	return [checkId, img, inCart, name, price, id, addToCart, item];
    }

    class Card extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$4, create_fragment$5, safe_not_equal, { item: 7, checkId: 0 });
    	}
    }

    var items = [
    	{
    		name: 'laptops',
    		price: '500',
    		img: 'laptop1.png',
    		id: 1
    	},
    	{
    		name: 'Latest PC',
    		price: '1,000',
    		img: 'mobile1.png',
    		id: 1
    	},
    	{
    		name: 'Latest laptop',
    		price: '1000',
    		img: 'laptop2.png',
    		id: 1
    	},
    	{
    		name: 'latest smart watch',
    		price: '5,000,000',
    		img: 'smartwatch.png',
    		id: 1
    	},
    	{
    		name: 'Monitor',
    		price: '2000',
    		img: 'display.png',
    		id: 1
    	},
    	
    	{
    		name: 'playstation',
    		price: '2,670',
    		img: 'playstation.png',
    		id: 1
    	},


    	{
    		name: 'laptop',
    		price: '500',
    		img: 'laptop1.png',
    		id: 2
    	},
    	{
    		name: 'Latest PC',
    		price: '1,000',
    		img: 'mobile1.png',
    		id: 2
    	},
    	{
    		name: 'Latest laptop',
    		price: '1000',
    		img: 'laptop2.png',
    		id: 2
    	},
    	{
    		name: 'latest smart watch',
    		price: '5,000,000',
    		img: 'smartwatch.png',
    		id: 2
    	},
    	{
    		name: 'Monitor',
    		price: '2000',
    		img: 'display.png',
    		id: 2
    	},
    	
    	{
    		name: 'playstation',
    		price: '2,670',
    		img: 'playstation.png',
    		id: 2
    	}

    ];

    /* src\CartComponents\CardWrapper.svelte generated by Svelte v3.38.2 */

    function get_each_context$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[0] = list[i];
    	return child_ctx;
    }

    // (10:4) {#each items as item}
    function create_each_block$1(ctx) {
    	let div;
    	let card;
    	let t;
    	let current;
    	card = new Card({ props: { item: /*item*/ ctx[0] } });

    	return {
    		c() {
    			div = element("div");
    			create_component(card.$$.fragment);
    			t = space();
    			attr(div, "class", "col-md-4");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			mount_component(card, div, null);
    			append(div, t);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(card.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(card.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_component(card);
    		}
    	};
    }

    function create_fragment$4(ctx) {
    	let div1;
    	let div0;
    	let current;
    	let each_value = items;
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	return {
    		c() {
    			div1 = element("div");
    			div0 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr(div0, "class", "row");
    			attr(div1, "class", "container");
    		},
    		m(target, anchor) {
    			insert(target, div1, anchor);
    			append(div1, div0);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div0, null);
    			}

    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*items*/ 0) {
    				each_value = items;
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$1(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block$1(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(div0, null);
    					}
    				}

    				group_outros();

    				for (i = each_value.length; i < each_blocks.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o(local) {
    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    class CardWrapper extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$4, safe_not_equal, {});
    	}
    }

    /* src\CartComponents\Navbar.svelte generated by Svelte v3.38.2 */

    function create_if_block$2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text(/*cart_sum*/ ctx[0]);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*cart_sum*/ 1) set_data(t, /*cart_sum*/ ctx[0]);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$3(ctx) {
    	let nav;
    	let div1;
    	let a0;
    	let t1;
    	let div0;
    	let t3;
    	let ul1;
    	let li1;
    	let a2;
    	let t5;
    	let li2;
    	let t6;
    	let br;
    	let mounted;
    	let dispose;
    	let if_block = /*cart_sum*/ ctx[0] > 0 && create_if_block$2(ctx);

    	return {
    		c() {
    			nav = element("nav");
    			div1 = element("div");
    			a0 = element("a");
    			a0.textContent = "OurShop";
    			t1 = space();
    			div0 = element("div");
    			div0.innerHTML = `<ul class="navbar-nav mr-auto"><li class="nav-item"><a class="nav-link" href="#">Electronics</a></li></ul>`;
    			t3 = space();
    			ul1 = element("ul");
    			li1 = element("li");
    			a2 = element("a");

    			a2.innerHTML = `Items in Cart
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-cart-dash-fill" viewBox="0 0 16 16"><path d="M.5 1a.5.5 0 0 0 0 1h1.11l.401 1.607 1.498 7.985A.5.5 0 0 0 4 12h1a2 2 0 1 0 0 4 2 2 0 0 0 0-4h7a2 2 0 1 0 0 4 2 2 0 0 0 0-4h1a.5.5 0 0 0 .491-.408l1.5-8A.5.5 0 0 0 14.5 3H2.89l-.405-1.621A.5.5 0 0 0 2 1H.5zM6 14a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM6.5 7h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1z"></path></svg>`;

    			t5 = space();
    			li2 = element("li");
    			if (if_block) if_block.c();
    			t6 = space();
    			br = element("br");
    			attr(a0, "class", "navbar-brand logo-font point");
    			attr(a0, "id", "brand");
    			attr(div0, "class", "collapse navbar-collapse");
    			attr(div0, "id", "links");
    			attr(a2, "class", "nav-link");
    			attr(li1, "class", "nav-item active");
    			attr(li2, "class", "nav-link active");
    			attr(ul1, "class", "navbar-nav ml-auto");
    			attr(div1, "class", "container");
    			attr(nav, "class", "navbar navbar-dark bg-secondary navbar-expand-lg navbar-dark ");
    		},
    		m(target, anchor) {
    			insert(target, nav, anchor);
    			append(nav, div1);
    			append(div1, a0);
    			append(div1, t1);
    			append(div1, div0);
    			append(div1, t3);
    			append(div1, ul1);
    			append(ul1, li1);
    			append(li1, a2);
    			append(ul1, t5);
    			append(ul1, li2);
    			if (if_block) if_block.m(li2, null);
    			insert(target, t6, anchor);
    			insert(target, br, anchor);

    			if (!mounted) {
    				dispose = [
    					listen(a0, "click", /*goToHome*/ ctx[1]),
    					listen(a2, "click", /*goToCheckout*/ ctx[2])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (/*cart_sum*/ ctx[0] > 0) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block$2(ctx);
    					if_block.c();
    					if_block.m(li2, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(nav);
    			if (if_block) if_block.d();
    			if (detaching) detach(t6);
    			if (detaching) detach(br);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$3($$self, $$props, $$invalidate) {
    	const dispatch = createEventDispatcher();
    	let cart_sum = 0;

    	cart.subscribe(items => {
    		const itemValues = Object.values(items);
    		$$invalidate(0, cart_sum = 0);

    		itemValues.forEach(item => {
    			$$invalidate(0, cart_sum += item.count);
    		});
    	});

    	function goToHome() {
    		dispatch("nav", { option: "home", checkId: 2 });
    	}

    	function goToCheckout() {
    		dispatch("nav", { option: "checkout" });
    	}

    	return [cart_sum, goToHome, goToCheckout];
    }

    class Navbar extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, {});
    	}
    }

    /* src\CartComponents\CheckoutItem.svelte generated by Svelte v3.38.2 */

    function create_fragment$2(ctx) {
    	let div2;
    	let img_1;
    	let img_1_src_value;
    	let t0;
    	let div1;
    	let h3;
    	let t2;
    	let p;
    	let t5;
    	let div0;
    	let button0;
    	let t7;
    	let t8_value = " " + "";
    	let t8;
    	let t9;
    	let span;
    	let t10;
    	let t11;
    	let t12_value = " " + "";
    	let t12;
    	let t13;
    	let button1;
    	let t15;
    	let t16_value = " " + "";
    	let t16;
    	let t17;
    	let button2;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			div2 = element("div");
    			img_1 = element("img");
    			t0 = space();
    			div1 = element("div");
    			h3 = element("h3");
    			h3.textContent = `${/*name*/ ctx[1]}`;
    			t2 = space();
    			p = element("p");
    			p.textContent = `Price: \$ ${/*price*/ ctx[2]}`;
    			t5 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "+";
    			t7 = space();
    			t8 = text(t8_value);
    			t9 = space();
    			span = element("span");
    			t10 = text(/*count*/ ctx[0]);
    			t11 = space();
    			t12 = text(t12_value);
    			t13 = space();
    			button1 = element("button");
    			button1.textContent = "-";
    			t15 = space();
    			t16 = text(t16_value);
    			t17 = space();
    			button2 = element("button");
    			button2.innerHTML = `<object aria-label="remove" type="image/svg+xml" data="img/svg/cancel.svg"></object>`;
    			attr(img_1, "class", "img-fluid img-thumbnail");
    			attr(img_1, "width", "300");
    			if (img_1.src !== (img_1_src_value = `img/${/*img*/ ctx[3]}`)) attr(img_1, "src", img_1_src_value);
    			attr(img_1, "alt", /*name*/ ctx[1]);
    			attr(h3, "class", "title");
    			attr(p, "class", "price");
    			attr(button0, "type", "button");
    			attr(button0, "class", "btn btn-success add");
    			attr(button1, "type", "button");
    			attr(button1, "class", "btn btn-warning");
    			attr(button2, "type", "button");
    			attr(button2, "class", "btn btn-sm btn-danger");
    			attr(div0, "class", "col");
    			attr(div1, "class", "item-meta-data");
    			attr(div2, "class", "row rows svelte-102k19");
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, img_1);
    			append(div2, t0);
    			append(div2, div1);
    			append(div1, h3);
    			append(div1, t2);
    			append(div1, p);
    			append(div1, t5);
    			append(div1, div0);
    			append(div0, button0);
    			append(div0, t7);
    			append(div0, t8);
    			append(div0, t9);
    			append(div0, span);
    			append(span, t10);
    			append(div0, t11);
    			append(div0, t12);
    			append(div0, t13);
    			append(div0, button1);
    			append(div0, t15);
    			append(div0, t16);
    			append(div0, t17);
    			append(div0, button2);

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*countButtonHandler*/ ctx[4]),
    					listen(button1, "click", /*countButtonHandler*/ ctx[4]),
    					listen(button2, "click", /*removeItem*/ ctx[5])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*count*/ 1) set_data(t10, /*count*/ ctx[0]);
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div2);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { item } = $$props;
    	let { name, price, img, count } = item;

    	const countButtonHandler = e => {
    		if (e.target.classList.contains("add")) {
    			$$invalidate(0, count++, count);
    		} else if (count >= 1) {
    			$$invalidate(0, count--, count);
    		}

    		cart.update(n => ({ ...n, [name]: { ...n[name], count } }));
    	};

    	const removeItem = () => {
    		cart.update(n => {
    			delete n[name];
    			return n;
    		});
    	};

    	$$self.$$set = $$props => {
    		if ("item" in $$props) $$invalidate(6, item = $$props.item);
    	};

    	return [count, name, price, img, countButtonHandler, removeItem, item];
    }

    class CheckoutItem extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, { item: 6 });
    	}
    }

    /* src\CartComponents\Checkout.svelte generated by Svelte v3.38.2 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[4] = list[i];
    	return child_ctx;
    }

    // (31:2) {:else}
    function create_else_block_1(ctx) {
    	let div0;
    	let each_blocks = [];
    	let each_1_lookup = new Map();
    	let t0;
    	let br;
    	let t1;
    	let div1;
    	let current;
    	let mounted;
    	let dispose;
    	let each_value = /*cartItems*/ ctx[1];
    	const get_key = ctx => /*item*/ ctx[4].name;

    	for (let i = 0; i < each_value.length; i += 1) {
    		let child_ctx = get_each_context(ctx, each_value, i);
    		let key = get_key(child_ctx);
    		each_1_lookup.set(key, each_blocks[i] = create_each_block(key, child_ctx));
    	}

    	return {
    		c() {
    			div0 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t0 = space();
    			br = element("br");
    			t1 = space();
    			div1 = element("div");
    			div1.textContent = "Checkout";
    			attr(div0, "class", "row");
    			attr(div1, "class", "btn btn-success btn-lg btn-block");
    		},
    		m(target, anchor) {
    			insert(target, div0, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div0, null);
    			}

    			insert(target, t0, anchor);
    			insert(target, br, anchor);
    			insert(target, t1, anchor);
    			insert(target, div1, anchor);
    			current = true;

    			if (!mounted) {
    				dispose = listen(div1, "click", /*checkout*/ ctx[2]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*cartItems*/ 2) {
    				each_value = /*cartItems*/ ctx[1];
    				group_outros();
    				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, div0, outro_and_destroy_block, create_each_block, null, get_each_context);
    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o(local) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div0);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].d();
    			}

    			if (detaching) detach(t0);
    			if (detaching) detach(br);
    			if (detaching) detach(t1);
    			if (detaching) detach(div1);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (25:2) {#if cartItems.length === 0}
    function create_if_block$1(ctx) {
    	let if_block_anchor;

    	function select_block_type_1(ctx, dirty) {
    		if (/*checkedOut*/ ctx[0]) return create_if_block_1;
    		return create_else_block$1;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block = current_block_type(ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (current_block_type !== (current_block_type = select_block_type_1(ctx))) {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (33:4) {#each cartItems as item (item.name)}
    function create_each_block(key_1, ctx) {
    	let first;
    	let checkoutitem;
    	let current;
    	checkoutitem = new CheckoutItem({ props: { item: /*item*/ ctx[4] } });

    	return {
    		key: key_1,
    		first: null,
    		c() {
    			first = empty();
    			create_component(checkoutitem.$$.fragment);
    			this.first = first;
    		},
    		m(target, anchor) {
    			insert(target, first, anchor);
    			mount_component(checkoutitem, target, anchor);
    			current = true;
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			const checkoutitem_changes = {};
    			if (dirty & /*cartItems*/ 2) checkoutitem_changes.item = /*item*/ ctx[4];
    			checkoutitem.$set(checkoutitem_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(checkoutitem.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(checkoutitem.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(first);
    			destroy_component(checkoutitem, detaching);
    		}
    	};
    }

    // (28:4) {:else}
    function create_else_block$1(ctx) {
    	let p;

    	return {
    		c() {
    			p = element("p");
    			p.textContent = "Your cart is empty";
    			attr(p, "class", "empty-message");
    		},
    		m(target, anchor) {
    			insert(target, p, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(p);
    		}
    	};
    }

    // (26:4) {#if checkedOut}
    function create_if_block_1(ctx) {
    	let p;

    	return {
    		c() {
    			p = element("p");
    			p.textContent = "Thank you for shopping with us";
    			attr(p, "class", "empty-message");
    		},
    		m(target, anchor) {
    			insert(target, p, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(p);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let div2;
    	let h1;
    	let t1;
    	let div1;
    	let div0;
    	let current_block_type_index;
    	let if_block;
    	let current;
    	const if_block_creators = [create_if_block$1, create_else_block_1];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*cartItems*/ ctx[1].length === 0) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	return {
    		c() {
    			div2 = element("div");
    			h1 = element("h1");
    			h1.textContent = "My Cart";
    			t1 = space();
    			div1 = element("div");
    			div0 = element("div");
    			if_block.c();
    			attr(div0, "class", "col-sm");
    			attr(div1, "class", "row");
    			attr(div2, "class", "container");
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, h1);
    			append(div2, t1);
    			append(div2, div1);
    			append(div1, div0);
    			if_blocks[current_block_type_index].m(div0, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(div0, null);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div2);
    			if_blocks[current_block_type_index].d();
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let checkedOut = false;
    	let cartItems = [];

    	cart.subscribe(items => {
    		$$invalidate(1, cartItems = Object.values(items));
    	});

    	const checkout = () => {
    		$$invalidate(0, checkedOut = true);

    		cart.update(n => {
    			return {};
    		});
    	};

    	return [checkedOut, cartItems, checkout];
    }

    class Checkout extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});
    	}
    }

    /* src\App.svelte generated by Svelte v3.38.2 */

    function create_else_block(ctx) {
    	let checkout;
    	let current;
    	checkout = new Checkout({});

    	return {
    		c() {
    			create_component(checkout.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(checkout, target, anchor);
    			current = true;
    		},
    		i(local) {
    			if (current) return;
    			transition_in(checkout.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(checkout.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(checkout, detaching);
    		}
    	};
    }

    // (13:2) {#if nav === 'home'}
    function create_if_block(ctx) {
    	let cardwrapper;
    	let current;
    	cardwrapper = new CardWrapper({});

    	return {
    		c() {
    			create_component(cardwrapper.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(cardwrapper, target, anchor);
    			current = true;
    		},
    		i(local) {
    			if (current) return;
    			transition_in(cardwrapper.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(cardwrapper.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(cardwrapper, detaching);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let navbar;
    	let t;
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	navbar = new Navbar({});
    	navbar.$on("nav", /*navHandler*/ ctx[1]);
    	const if_block_creators = [create_if_block, create_else_block];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*nav*/ ctx[0] === "home") return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	return {
    		c() {
    			create_component(navbar.$$.fragment);
    			t = space();
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			mount_component(navbar, target, anchor);
    			insert(target, t, anchor);
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index !== previous_block_index) {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				}

    				transition_in(if_block, 1);
    				if_block.m(if_block_anchor.parentNode, if_block_anchor);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(navbar.$$.fragment, local);
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(navbar.$$.fragment, local);
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(navbar, detaching);
    			if (detaching) detach(t);
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let nav = "home";

    	function navHandler(event) {
    		$$invalidate(0, nav = event.detail.option);
    	}

    	return [nav, navHandler];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    const app = new App({
    	target: document.body,
    	props: {
    		name: 'world'
    	}
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
