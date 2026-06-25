import { mount } from 'svelte';
import App from './App.svelte';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/editor.css';
import 'prosemirror-view/style/prosemirror.css';

mount(App, { target: document.getElementById('root')! });
