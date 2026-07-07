import { mount } from 'svelte';
import App from './App.svelte';
import { installDomSelectionGuard } from './editor/domSelectionGuard.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/editor.css';
import 'prosemirror-view/style/prosemirror.css';

installDomSelectionGuard();
mount(App, { target: document.getElementById('root')! });
