// ==UserScript==
// @name         Plex downloader
// @description  Adds a download button to the Plex desktop interface. Works on episodes, movies, whole seasons, and entire shows.
// @author       Mow
// @version      1.4.8
// @license      MIT
// @grant        none
// @match        https://app.plex.tv/desktop/
// @run-at       document-start
// @namespace    https://greasyfork.org/users/1260133
// ==/UserScript==


// This code is a heavy modification of the existing PlxDwnld project
// https://sharedriches.com/plex-scripts/piplongrun/

(function() {
	"use strict";
	
	const logPrefix = "[USERJS Plex Downloader]";
	const domPrefix = `USERJSINJECTED-${Math.random().toString(36).slice(2)}_`;
	
	// Settings of what element to clone, where to inject it, and any additional CSS to use
	const injectionElement    = "button[data-testid=preplay-play]"; // Play button
	const injectPosition      = "after";
	const domElementStyle     = "";
	const domElementInnerHTML = "<svg xmlns='http://www.w3.org/2000/svg' style='height: 1.5rem;width: 1.5rem;margin: 0 4px 0 0;'><g><path d='M3,12.3v7a2,2,0,0,0,2,2H19a2,2,0,0,0,2-2v-7' fill='none' stroke='currentcolor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'></path><g><polyline data-name='Right' fill='none' id='Right-2' points='7.9 12.3 12 16.3 16.1 12.3' stroke='currentcolor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'></polyline><line fill='none' stroke='currentcolor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' x1='12' x2='12' y1='2.7' y2='14.2'></line></g></g></svg>Download";
	
	
	
	// Should not be visible in normal operation
	function errorHandle(msg) {
		console.log(`${logPrefix} ${msg.toString()}`);
	}
	
	
	// Turn a number of bytes to a more friendly size display
	function makeFilesize(numbytes) {
		const units = [ "B", "KB", "MB", "GB" ];
		let ui = 0;
		
		numbytes = parseInt(numbytes);
		
		if (isNaN(numbytes)) {
			return "<unknown>";
		}
		
		// I don't care what hard drive manufacturers say, there are 1024 bytes in a kilobyte
		while (numbytes >= 1024 && ui < units.length - 1) {
			numbytes /= 1024;
			ui++;
		}
		
		if (ui !== 0) {
			return `${numbytes.toFixed(2)} ${units[ui]}`;
		} else {
			return `${numbytes} ${units[ui]}`;
		}
	}
	
	
	// The modal is the popup that prompts you for a selection of a group media item like a whole season of a TV show
	const modal = {};
	modal.container = document.createElement(`${domPrefix}element`);
	modal.container.id = `${domPrefix}modal_container`;
	
	// Styling and element tree as careful as possible to not interfere or be interfered with by Plex
	modal.stylesheet = `
		${domPrefix}element {
			margin: 0;
			padding: 0;
			color: #eee;
		}
		
		#${domPrefix}modal_container {
			width: 0;
			height: 0;
			display: block;
			pointer-events: none;
			transition: opacity 0.2s;
			opacity: 0;
		}
		
		#${domPrefix}modal_container.${domPrefix}open {
			pointer-events: auto;
			opacity: 1;
		}
		
		#${domPrefix}modal_overlay {
			width: 100%;
			height: 100%;
			position: fixed;
			top: 0;
			left: 0;
			z-index: 99990;
			display: flex;
			align-items: center;
			justify-content: center;
			background: #0007;
		}
		
		#${domPrefix}modal_popup {
			width: 90%;
			max-width: 550px;
			height: 80%;
			max-height: 600px;
			display: flex;
			flex-direction: column;
			border-radius: 14px;
			background: #3f3f42;
			padding: 20px;
			text-align: center;
			box-shadow: 0 0 10px 1px black;
			position: relative;
			transition: top 0.2s ease-out;
			top: -15%;
		}
		
		#${domPrefix}modal_container.${domPrefix}open #${domPrefix}modal_popup {
			top: -2%;
		}
		
		#${domPrefix}modal_title {
			font-size: 16pt;
		}
		
		#${domPrefix}modal_itemcontainer {
			width: 100%;
			overflow-y: scroll;
			scrollbar-color: #777 #333;
			background: #0005;
			border-radius: 6px;
			box-shadow: 0 0 4px 1px #0003 inset;
			flex: 1;
		}
		
		#${domPrefix}modal_topx {
			position: absolute;
			top: 1em;
			right: 1em;
			cursor: pointer;
			height: 1.5em;
			width: 1.5em;
			border-radius: 3px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 14pt;
			color: #fff8;
			background: transparent;
			border: none;
		}
		
		#${domPrefix}modal_topx:hover {
			background: #fff2;
			color: #000c;
		}
		
		#${domPrefix}modal_downloadbutton {
			display: inline-flex;
			justify-content: center;
			align-items: center;
			background: #0008;
			padding: 0.2em 0.5em;
			border-radius: 4px;
			cursor: pointer;
			color: #eee;
			border: 1px solid #5555;
			font-size: 14pt;
			transition: opacity 0.15s;
		}
		
		#${domPrefix}modal_downloadbutton:hover:not([disabled]) {
			background: #0007;
		}
		
		#${domPrefix}modal_downloadbutton[disabled] {
			opacity: 0.5;
			cursor: default;
		}
		
		#${domPrefix}modal_container .${domPrefix}modal_item {
			text-align: left;
			width: 100%;
			display: block;
		}
		
		#${domPrefix}modal_container .${domPrefix}modal_item label {
			cursor: pointer;
			padding: 7px 4px;
			border-radius: 3px;
			display: flex;
			align-items: center;
		}
		
		#${domPrefix}modal_container .${domPrefix}modal_item label:hover {
			background: #fff1;
		}
		
		#${domPrefix}modal_container input[type="checkbox"] {
			margin: 0 0.8em;
			height: 1rem;
			width: 1rem;
			cursor: pointer;
			accent-color: #1394e1;
		}
		
		#${domPrefix}modal_container *:focus-visible {
			outline: 2px solid #408cffbf;
			outline-offset: 2px;
		}
	`;
	
	modal.container.innerHTML = `
		<style>${modal.stylesheet}</style>
		
		<${domPrefix}element id="${domPrefix}modal_overlay">
			<${domPrefix}element id="${domPrefix}modal_popup" role="dialog" aria-modal="true" aria-labelledby="${domPrefix}modal_title">
				<${domPrefix}element id="${domPrefix}modal_title">Download</${domPrefix}element>
				<input type="button" id="${domPrefix}modal_topx" value="&#x2715;" aria-label="close" tabindex="0"/>
				
				<${domPrefix}element class="${domPrefix}modal_item">
					<label for="${domPrefix}modal_checkall" style="font-weight: 600; color: inherit;">
						<input type="checkbox" id="${domPrefix}modal_checkall" checked="true" tabindex="0"/>
						<${domPrefix}element>Select all</${domPrefix}element>
					</label>
				</${domPrefix}element>
				
				<input type="hidden" tabindex="-1" id="${domPrefix}modal_clientid" />
				<input type="hidden" tabindex="-1" id="${domPrefix}modal_parentid" />
				
				<${domPrefix}element id="${domPrefix}modal_itemcontainer"></${domPrefix}element>
				
				<${domPrefix}element style="display: block; margin: 1em;">
					Total download size: <${domPrefix}element id="${domPrefix}modal_downloadsize">0B</${domPrefix}element>
				</${domPrefix}element>
				
				<${domPrefix}element>
					<input type="button" id="${domPrefix}modal_downloadbutton" value="Download" tabindex="0"/>
				</${domPrefix}element
			</${domPrefix}element>
		</${domPrefix}element>
	`;
	
	// Must use querySelector here (or use names or tagnames) since subelements don't get getElementById
	modal.overlay        = modal.container.querySelector(`#${domPrefix}modal_overlay`);
	modal.popup          = modal.container.querySelector(`#${domPrefix}modal_popup`);
	modal.title          = modal.container.querySelector(`#${domPrefix}modal_title`);
	modal.itemContainer  = modal.container.querySelector(`#${domPrefix}modal_itemcontainer`);
	modal.topX           = modal.container.querySelector(`#${domPrefix}modal_topx`);
	modal.downloadButton = modal.container.querySelector(`#${domPrefix}modal_downloadbutton`);
	modal.checkAll       = modal.container.querySelector(`#${domPrefix}modal_checkall`);
	modal.clientId       = modal.container.querySelector(`#${domPrefix}modal_clientid`);
	modal.parentId       = modal.container.querySelector(`#${domPrefix}modal_parentid`);
	modal.downloadSize   = modal.container.querySelector(`#${domPrefix}modal_downloadsize`);
	
	// Live updating collection of items
	modal.itemCheckboxes  = modal.itemContainer.getElementsByTagName("input");
	
	modal.firstTab = modal.topX;
	modal.lastTab  = modal.downloadButton;
	
	// Allow Tab/Enter/Space to correctly interact with the modal
	modal.captureKeyPress = function(e) {
		// No keypresses are allowed to interact with any lower event listeners
		e.stopImmediatePropagation();
		
		switch (e.key) {
			case "Tab":
				// Move focus into the modal if it somehow isn't already
				if (!modal.container.contains(document.activeElement)) {
					e.preventDefault();
					modal.firstTab.focus();
					break;
				}
				
				// Clamp tabbing to the next element to the selectable elements within the modal
				// Shift key reverses the direction
				if (e.shiftKey) {
					if (document.activeElement === modal.firstTab) {
						e.preventDefault();
						modal.lastTab.focus();
					}
				} else {
					if (document.activeElement === modal.lastTab) {
						e.preventDefault();
						modal.firstTab.focus();
					}
				}
				
				break;
			
			case "Escape":
				modal.close();
				break;
			
			case "Enter":
				// The enter key interacting with checkboxes can be unreliable
				e.preventDefault();
				if (modal.container.contains(document.activeElement)) {
					document.activeElement.click();
				}
				break;
		}
	}
	
	// Modal removes itself from the DOM once its CSS transition is over
	modal.container.addEventListener("transitionend", function(e) {
		// Ignore any transitionend events fired by child elements
		if (e.target !== modal.container) return;
		
		// Look to remove the modal from the DOM
		if (!modal.container.classList.contains(`${domPrefix}open`)) {
			modal.container.remove();
		}
	});
	
	// Show the modal on screen
	modal.open = function() {
		// Reset all checkboxes
		for (let checkbox of modal.itemCheckboxes) {
			checkbox.checked = true;
		}
		
		modal.checkAll.checked = true;
		modal.checkBoxChange();
		
		document.body.appendChild(modal.container);
		
		window.addEventListener("keydown", modal.captureKeyPress, { capturing : true });
		window.addEventListener("popstate", modal.close);
		
		modal.lastTab.focus();
		
		// CSS animation entrance
		modal.container.classList.add(`${domPrefix}open`);
	}
	
	// Close modal
	modal.close = function() {
		// Stop capturing keypresses
		window.removeEventListener("keydown", modal.captureKeyPress, { capturing : true });
		
		// Stop listening to popstate too
		window.removeEventListener("popstate", modal.close);
		
		// CSS animation exit, triggers the removal from the DOM
		modal.container.classList.remove(`${domPrefix}open`);
	}
	
	// Hook functionality for modal
	modal.overlay.addEventListener("click", modal.close);
	modal.popup.addEventListener("click", function(e) { e.stopPropagation() });
	modal.topX.addEventListener("click", modal.close);
	
	modal.checkAll.addEventListener("change", function() {
		for (let checkbox of modal.itemCheckboxes) {
			checkbox.checked = modal.checkAll.checked;
		}
		
		modal.checkBoxChange();
	});
	
	// Download all checked items
	modal.downloadButton.addEventListener("click", function() {
		let clientId = modal.clientId.value;
		for (let checkbox of modal.itemCheckboxes) {
			if (checkbox.checked) {
				download.fromMedia(clientId, checkbox.value);
			}
		}
		modal.close();
	});
	
	modal.checkBoxChange = function() {
		// Add up total filesize
		let totalFilesize = 0;
		for (let checkbox of modal.itemCheckboxes) {
			if (checkbox.checked) {
				totalFilesize += serverData.servers[modal.clientId.value].mediaData[checkbox.value].filesize;
			}
		}
		
		modal.downloadSize.textContent = makeFilesize(totalFilesize);
		modal.downloadButton.disabled = (totalFilesize === 0); // Can't download nothing
	}
	
	// Called by the injected DOM element to populate the modal
	modal.populate = function(clientId, metadataId) {
		while (modal.itemContainer.hasChildNodes()) {
			modal.itemContainer.firstChild.remove();
		}
		
		for (let childId of serverData.servers[clientId].mediaData[metadataId].children) {
			let item = document.createElement(`${domPrefix}element`);
			item.className = `${domPrefix}modal_item`;
			item.innerHTML = `
				<label for="${domPrefix}item_checkbox_${childId}">
					<input type="checkbox" id="${domPrefix}item_checkbox_${childId}" checked="true" value="${childId}" tabindex="0"/>
					<${domPrefix}element>${serverData.servers[clientId].mediaData[childId].displayName}</${domPrefix}element>
				</label>
			`;
			
			modal.itemContainer.appendChild(item);
		}
		
		// Hook checking/unchecking the box
		for (let checkbox of modal.itemCheckboxes) {
			checkbox.addEventListener("change", modal.checkBoxChange);
		}
		
		if (serverData.servers[clientId].mediaData[metadataId].hasOwnProperty("displayName")) {
			modal.title.textContent = serverData.servers[clientId].mediaData[metadataId].displayName;
		} else {
			modal.title.textContent = "Download";
		}
		
		modal.clientId.value = clientId;
		modal.parentId.value = metadataId;
		
		modal.checkBoxChange();
	}
	
	
	
	
	// The observer object that waits for page to be right to inject new functionality
	const DOMObserver = {};
	
	// Check to see if we need to modify the DOM, do so if yes
	DOMObserver.callback = async function() {
		// Detect the presence of the injection point first
		const injectionPoint = document.querySelector(injectionElement);  
		if (!injectionPoint) return;
		
		// We can always stop observing when we have found the injection point
		// Note: This relies on the fact that the page does not mutate without also
		//       triggering hashchange. This is currently true (most of the time) but
		//       may change in future plex desktop updates
		DOMObserver.stop();
		
		// Should be on the right URL if we're observing the DOM and the injection point is found
		const urlIds = parseUrl();
		if (!urlIds) return;
		
		// Make sure we don't ever double trigger for any reason
		if (document.getElementById(`${domPrefix}DownloadButton`)) return;
		
		// Inject new button and await the data to add functionality
		const domElement = modifyDom(injectionPoint);
		let success = await domCallback(domElement, urlIds.clientId, urlIds.metadataId);
		if (success) {
			domElement.disabled = false;
			domElement.style.opacity = 1;
		} else {
			domElement.style.opacity = 0.25;
		}
	}
	
	DOMObserver.mo = new MutationObserver(DOMObserver.callback);
	
	DOMObserver.observe = function() {
		DOMObserver.mo.observe(document.body, { childList : true, subtree : true });
	}
	
	DOMObserver.stop = function() {
		DOMObserver.mo.disconnect();
	}
	
	
	
	// Fetch XML and return parsed body
	const xmlParser = new DOMParser();
	async function fetchXml(url) {
		const response     = await fetch(url);
		const responseText = await response.text();
		const responseXml  = xmlParser.parseFromString(responseText, "text/xml");
		return responseXml;
	}
	
	// Fetch JSON and return parsed body
	async function fetchJSON(url) {
		const response     = await fetch(url, { headers : { accept : "application/json" } });
		const responseJSON = await response.json();
		return responseJSON;
	}
	
	
	
	
	// Server identifiers and their respective data (loaded over API request)
	const serverData = {
		servers : {
			// Example data
			/*
			"fd174cfae71eba992435d781704afe857609471b" : {
				"baseUri"     : "https://1-1-1-1.e38c3319c1a4a0f67c5cc173d314d74cb19e862b.plex.direct:13100",
				"accessToken" : "fH5dn-HgT7Ihb3S-p9-k",
				"mediaData"   : {}
			}
			*/
		},
		
		// Promise for loading server data, ensure it is loaded before we try to pull media data
		promise : null,
	};
	
	// Merge new data object into serverData
	serverData.update = function(newData, serverDataScope) {
		serverDataScope = serverDataScope || serverData;
		
		for (let key in newData) {
			if (!serverDataScope.hasOwnProperty(key) || typeof newData[key] !== "object") {
				// Write directly if key doesn't exist or key contains POD
				serverDataScope[key] = newData[key];
			} else {
				// Merge objects if needed instead
				serverData.update(newData[key], serverDataScope[key]);
			}
		}
	}
	
	// Load server information for this user account from plex.tv API. Returns a bool indicating success
	serverData.load = async function() {
		// Ensure access token
		let serverToken = window.localStorage.getItem("myPlexAccessToken");
		if (serverToken === null) {
			errorHandle(`Cannot find a valid access token (localStorage Plex token missing).`);
			return false;
		}
		
		const apiResourceUrl = `https://plex.tv/api/resources?includeHttps=1&includeRelay=1&X-Plex-Token=${serverToken}`;
		let resourceXml;
		try {
			resourceXml = await fetchXml(apiResourceUrl);
		} catch(e) {
			errorHandle(`Cannot load valid server information (resources API call returned error ${e})`);
			return false;
		}
		
		const serverInfoXPath  = "//Device[@provides='server']";
		const servers = resourceXml.evaluate(serverInfoXPath, resourceXml, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
		// Stupid ugly iterator pattern. Yes this is how you're supposed to do this
		// https://developer.mozilla.org/en-US/docs/Web/API/XPathResult/iterateNext
		let server;
		while (server = servers.iterateNext()) {
			const clientId    = server.getAttribute("clientIdentifier");
			const accessToken = server.getAttribute("accessToken");
			if (!clientId || !accessToken) {
				errorHandle(`Cannot find valid server information (missing ID or token in API response).`);
				continue;
			}
			
			const connectionXPath = "//Connection[@local='0']";
			const conn = resourceXml.evaluate(connectionXPath, server, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
			if (!conn.singleNodeValue || !conn.singleNodeValue.getAttribute("uri")) {
				errorHandle(`Cannot find valid server information (no connection data for server ${clientId}).`);
				continue;
			}
			
			const baseUri = conn.singleNodeValue.getAttribute("uri");
			
			serverData.update({
				servers : {
					[clientId] : {
						baseUri     : baseUri,
						accessToken : accessToken,
						mediaData   : {},
					}
				}
			});
			
			
			const relayXPath = "//Connection[@relay='1']";
			const relay = resourceXml.evaluate(relayXPath, server, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
			if (!relay.singleNodeValue || !relay.singleNodeValue.getAttribute("uri")) {
				// Can ignore a possible error here as this is only a fallback option
				continue;
			}
			
			const fallbackUri = relay.singleNodeValue.getAttribute("uri");
			serverData.update({
				servers : {
					[clientId] : {
						fallbackUri : fallbackUri,
					}
				}
			});
		}
		
		return true;
	}
	
	// Keep trying loading server data if it happens to fail
	serverData.available = async function() {
		if (!(await serverData.promise)) {
			// Reload
			serverData.promise = serverData.load();
			
			// If this one doesn't work we just fail and try again later
			return await serverData.promise;
		}
		
		return true;
	}
	
	// Merge video node data from API response into the serverData media cache
	serverData.updateMedia = function(clientId, videoNode) {
		let displayName;
		switch (videoNode.type) {
			case "episode":
				displayName = `${videoNode.parentTitle} episode ${videoNode.index}, ${videoNode.title}`;
				break;
			
			case "movie":
				displayName = `${videoNode.title} (${videoNode.year})`;
				break;
			
			default:
				displayName = `${videoNode.title}`;
				break;
		}
		
		serverData.update({
			servers : {
				[clientId] : {
					mediaData : {
						[videoNode.ratingKey] : {
							key         : videoNode.Media[0].Part[0].key,
							displayName : displayName,
							filesize    : videoNode.Media[0].Part[0].size,
						}
					}
				}
			}
		});
	}
	
	// Pull API response for this media item and handle parents/grandparents. Returns a bool indicating success
	serverData.loadMediaData = async function(clientId, metadataId) {
		// Make sure server data has loaded in
		if (!(await serverData.available())) {
			errorHandle(`Server information loading failed, trying again on next trigger.`);
			return false;
		}
		
		// Get access token and base URI for this server
		if (!serverData.servers[clientId].hasOwnProperty("baseUri") ||
			!serverData.servers[clientId].hasOwnProperty("accessToken")) {
			errorHandle(`No server information for clientId ${clientId} when trying to load media data`);
			return false;
		}
		
		const baseUri     = serverData.servers[clientId].baseUri;
		const accessToken = serverData.servers[clientId].accessToken;
		
		try {
			// Request library data from this server using metadata ID
			const libraryUrl  = `${baseUri}/library/metadata/${metadataId}?X-Plex-Token=${accessToken}`;
			const libraryJSON = await fetchJSON(libraryUrl);
			
			// Determine if this is media or just a parent to media
			let leafCount = false;
			if (libraryJSON.MediaContainer.Metadata[0].hasOwnProperty("leafCount")) {
				leafCount = libraryJSON.MediaContainer.Metadata[0].leafCount;
			}
			
			let childCount = false;
			if (libraryJSON.MediaContainer.Metadata[0].hasOwnProperty("childCount")) {
				childCount = libraryJSON.MediaContainer.Metadata[0].childCount;
			}
			
			if (leafCount || childCount) {
				// This is a group media item (show, season) with children
				
				// Get all of its children, either by leaves or children directly
				// A series only has seasons as children, not the episodes. allLeaves must be used there
				let childrenUrl;
				if (childCount && leafCount && (childCount !== leafCount)) {
					childrenUrl = `${baseUri}/library/metadata/${metadataId}/allLeaves?X-Plex-Token=${accessToken}`;
				} else {
					childrenUrl = `${baseUri}/library/metadata/${metadataId}/children?X-Plex-Token=${accessToken}`;
				}
				
				const childrenJSON = await fetchJSON(childrenUrl);
				const childVideoNodes = childrenJSON.MediaContainer.Metadata;
				
				// Save a title for this if possible
				if (libraryJSON.MediaContainer.Metadata[0].hasOwnProperty("title")) {
					serverData.servers[clientId].mediaData[metadataId].displayName = libraryJSON.MediaContainer.Metadata[0].title;
				}
				
				// Iterate over the children of this media item and gather their data
				serverData.servers[clientId].mediaData[metadataId].children = [];
				
				for (let i = 0; i < childVideoNodes.length; i++) {
					let childMetadataId = childVideoNodes[i].ratingKey;
					serverData.updateMedia(clientId, childVideoNodes[i]);
					
					serverData.servers[clientId].mediaData[metadataId].children.push(childMetadataId);
					
					// Copy promise to child
					serverData.servers[clientId].mediaData[childMetadataId].promise = serverData.servers[clientId].mediaData[metadataId].promise;
				}
			} else {
				// This is a regular media item (episode, movie)
				const videoNode = libraryJSON.MediaContainer.Metadata[0];
				serverData.updateMedia(clientId, videoNode);
			}
		} catch(e) {
			// Initial request(s) failed, but we can try again if there is a fallback to use
			if (serverData.servers[clientId].fallbackUri) {
				serverData.servers[clientId].baseUri = serverData.servers[clientId].fallbackUri;
				serverData.servers[clientId].fallbackUri = false;
				
				// Run again from the top
				return await serverData.loadMediaData(clientId, metadataId);
			} else {
				errorHandle(`Could not establish connection to server at ${serverData.servers[clientId].baseUri}: ${e}`);
				return false;
			}
		}
		
		return true;
	}
	
	// Try to ensure media data is loaded for a given item. Returns a bool indicating if the item is available
	serverData.mediaAvailable = async function(clientId, metadataId) {
		if (serverData.servers[clientId].mediaData[metadataId].promise) {
			return await serverData.servers[clientId].mediaData[metadataId].promise;
		} else {
			// Note we don't create a request here as this method is used 
			// in handleHashChange to detect if we need to create a new request
			return false;
		}
	}
	
	
	
	// Parse current URL to get clientId and metadataId, or `false` if unable to match
	const metadataIdRegex = /^\/library\/(?:metadata|collections)\/(\d+)$/;
	const clientIdRegex   = /^\/server\/([a-f0-9]{40})\/(?:details|activity)$/;
	function parseUrl() {
		if (!location.hash.startsWith("#!/")) return false;
		
		// Use a URL object to parse the shebang
		let shebang = location.hash.slice(2);
		let hashUrl = new URL(`https://dummy.plex.tv${shebang}`);
		
		// URL.pathname should be something like:
		//  /server/fd174cfae71eba992435d781704afe857609471b/details 
		let clientIdMatch = clientIdRegex.exec(hashUrl.pathname);
		if (!clientIdMatch || clientIdMatch.length !== 2) return false;
		
		// URL.searchParams should be something like:
		//  ?key=%2Flibrary%2Fmetadata%2F25439&context=home%3Ahub.continueWatching~0~0 
		// of which we only care about ?key=[], which should be something like:
		//  /library/metadata/25439 
		let mediaKey = hashUrl.searchParams.get("key");
		let metadataIdMatch = metadataIdRegex.exec(mediaKey);
		if (!metadataIdMatch || metadataIdMatch.length !== 2) return false;
		
		// Get rid of regex match and retain only capturing group
		let clientId   = clientIdMatch[1];
		let metadataId = metadataIdMatch[1];
		
		return {
			clientId   : clientId,
			metadataId : metadataId,
		};
	}
	
	
	// Start fetching a media item from the URL parameters, storing promise in serverData
	// Also handles avoiding duplicate API calls for the same media item
	async function handleHashChange() {
		let urlIds = parseUrl();
		if (!urlIds) {
			// If not on the right URL to inject new elements, don't bother observing
			// Note: this assumes the URL which triggers pulling media data is the same URL which
			//       is where the new element and functionality is to be injected. This is 
			//       currently true but may change in future plex desktop app updates.
			DOMObserver.stop();
			return;
		}
		
		// URL matches, observe the DOM for when the injection point loads
		// Also handle readyState if this is the page we start on
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", DOMObserver.observe);
		} else {
			DOMObserver.observe();
		}
		
		// Create media entry early
		serverData.update({
			servers : {
				[urlIds.clientId] : {
					mediaData : {
						[urlIds.metadataId] : { }
					}
				}
			}
		});
		
		if (!(await serverData.mediaAvailable(urlIds.clientId, urlIds.metadataId))) {
			let mediaPromise = serverData.loadMediaData(urlIds.clientId, urlIds.metadataId);
			serverData.servers[urlIds.clientId].mediaData[urlIds.metadataId].promise = mediaPromise;
		}
	}
	
	
	let download = {};
	
	download.frameName = `${domPrefix}downloadFrame`;
	
	// Initiate a download of a URI using iframes
	download.fromUri = function(uri) {
		let frame = document.createElement("iframe");
		frame.name = download.frameName;
		frame.style = "display: none !important;";
		document.body.appendChild(frame);
		frame.src = uri;
	}
	
	// Clean up old DOM elements from previous downloads, if needed
	download.cleanUp = function() {
		// There is no way to detect when the download dialog is closed, so just clean up here to prevent DOM clutter
		let oldFrames = document.getElementsByName(download.frameName);
		while (oldFrames.length !== 0) {
			oldFrames[0].remove();
		}
	}
	
	// Assemble download URI from key and base URI
	download.makeUri = function(clientId, metadataId) {
		const key         = serverData.servers[clientId].mediaData[metadataId].key;
		const baseUri     = serverData.servers[clientId].baseUri;
		const accessToken = serverData.servers[clientId].accessToken;
		
		const uri = `${baseUri}${key}?X-Plex-Token=${accessToken}&download=1`;
		return uri;
	}
	
	// Download a media item, handling parents/grandparents
	download.fromMedia = function(clientId, metadataId) {
		
		if (serverData.servers[clientId].mediaData[metadataId].hasOwnProperty("key")) {
			const uri = download.makeUri(clientId, metadataId);
			download.fromUri(uri);
		}
		
		if (serverData.servers[clientId].mediaData[metadataId].hasOwnProperty("children")) {
			for (let i = 0; i < serverData.servers[clientId].mediaData[metadataId].children.length; i++) {
				let childId = serverData.servers[clientId].mediaData[metadataId].children[i];
				download.fromMedia(clientId, childId);
			}
		}
	}
	
	
	// Create and add the new DOM element, return a reference to it
	function modifyDom(injectionPoint) {
		// Clone the tag of the injection point element
		const downloadButton = document.createElement(injectionPoint.tagName);
		downloadButton.id = `${domPrefix}DownloadButton`;
		downloadButton.innerHTML = domElementInnerHTML;
		
		// Steal CSS from the injection point element by copying its class name
		downloadButton.className = `${domPrefix}element ${injectionPoint.className}`;
		
		// Apply custom CSS first
		downloadButton.style = domElementStyle;
		
		// Match the font used by the text content of the injection point
		// We traverse the element and select the first text node, then use its parent
		let textNode = (function findTextNode(parent) {
			for (let child of parent.childNodes) {
				if (child.nodeType === HTMLElement.TEXT_NODE) {
					return child;
				}
				
				if (child.hasChildNodes()) {
					let recurseResult = findTextNode(child);
					if (recurseResult) {
						return recurseResult;
					}
				}
			}
			
			return false;
		})(injectionPoint);
		
		// If no text node was found as a child of the injection point, fall back to the injection point itself
		let textParentNode = textNode ? textNode.parentNode : injectionPoint;
		
		// Get computed font and apply it
		let textNodeStyle = getComputedStyle(textParentNode);
		downloadButton.style.font  = textNodeStyle.getPropertyValue("font");
		downloadButton.style.color = textNodeStyle.getPropertyValue("color");
		
		// Starts disabled
		downloadButton.style.opacity = 0.5;
		downloadButton.disabled = true;
		
		switch (injectPosition.toLowerCase()) {
			case "after":
				injectionPoint.after(downloadButton);
				break;
			
			case "before":
				injectionPoint.before(downloadButton);
				break;
			
			default:
				errorHandle(`Invalid injection position: ${injectPosition}`);
				break;
		}
		
		return downloadButton;
	}
	
	// Activate DOM element and hook clicking with function. Returns bool indicating success
	async function domCallback(domElement, clientId, metadataId) {
		// Make sure server data has loaded in
		if (!(await serverData.available())) {
			errorHandle(`Server information loading failed, trying again on next trigger.`);
			return false;
		}
		
		// Make sure we have media data for this item
		if (!(await serverData.mediaAvailable(clientId, metadataId))) {
			errorHandle(`Could not load data for metadataId ${metadataId}`);
			return false;
		}
		
		// Hook function to button if everything works
		const downloadFunction = function(e) {
			e.stopPropagation();
			download.cleanUp();
			
			// Open modal box for group media items
			if (serverData.servers[clientId].mediaData[metadataId].hasOwnProperty("children")) {
				if (modal.parentId.value !== metadataId) {
					modal.populate(clientId, metadataId);
				}
				modal.open();
			} else {
				// Download immediately for single media items
				download.fromMedia(clientId, metadataId);
			}
		};
		domElement.addEventListener("click", downloadFunction);
		
		// Add the filesize on hover, if available
		if (serverData.servers[clientId].mediaData[metadataId].hasOwnProperty("filesize")) {
			let filesize = makeFilesize(serverData.servers[clientId].mediaData[metadataId].filesize);
			domElement.setAttribute("title", filesize);
		}
		
		return true;
	}
	
	
	function init() {
		// Begin loading server data immediately
		serverData.promise = serverData.load();
		
		// Try to start immediately
		handleHashChange();
		window.addEventListener("hashchange", handleHashChange);
	}
	
	init();
})();
