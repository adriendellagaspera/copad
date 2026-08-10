import { mount } from 'svelte';
import App from './App.svelte';
import { parseSharedNavigation, applySharedNavigation } from './shareTarget.js';
import { asset } from './ui/imageIcons.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/editor.css';
import './styles/print.css';
import 'prosemirror-view/style/prosemirror.css';

applySharedNavigation(parseSharedNavigation(location.search));

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register(asset('sw.js'));
}

mount(App, { target: document.getElementById('root')! });
