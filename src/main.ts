import { mount } from 'svelte';
import App from './App.svelte';
import './styles.css';
import 'prosemirror-view/style/prosemirror.css';

mount(App, { target: document.getElementById('root')! });
