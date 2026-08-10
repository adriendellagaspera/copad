import { mount } from 'svelte';
import App from './App.svelte';
import { parseSharedNavigation, applySharedNavigation } from './shareTarget.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/editor.css';
import './styles/print.css';
import 'prosemirror-view/style/prosemirror.css';

applySharedNavigation(parseSharedNavigation(location.search));

if ('serviceWorker' in navigator) {
  // BASE_URL, not "/sw.js": a subpath build (--base=/copad/) would otherwise
  // register at the origin root, where nothing is served. See ui/imageIcons.ts.
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}

mount(App, { target: document.getElementById('root')! });
