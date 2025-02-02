// ==UserScript==
// @name         Cell Ontology and UBERON Request Helper
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Enhance Wikidata pages with quick access to formatted cell ontology and UBERON term requests
// @author       You
// @match        https://www.wikidata.org/wiki/Q*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // Helper functions
  function getItemId() {
      return location.pathname.replace('/wiki/', '');
  }

  // Ensure OOjs UI is loaded
  mw.loader.using('oojs-ui-core').done(function() {
    $(function() {
        // Only run this in the main namespace
        if (mw.config.get('wgNamespaceNumber') === 0) {
            const itemId = mw.config.get('wbEntityId'); // Get the current item ID
            Promise.all([isSubclassOfCell(itemId), isSubclassOfAnatomicalEntity(itemId)]).then(([isCell, isAnatomicalEntity]) => {
                if (isCell) {
                    addNTRButton(itemId, 'CL', createCLNTRBody);
                    addImageButton(itemId);
                } else if (isAnatomicalEntity) {
                    addNTRButton(itemId, 'UBERON', createUberonNTRBody);
                }
            });
        }
    });
  });

  async function isSubclassOfCell(item) {
      const query = `
      ASK {
          wd:${item} wdt:P279* wd:Q7868 .
      }
      `;
      const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query) + '&format=json';
      try {
          const response = await fetch(url);
          const data = await response.json();
          return data.boolean;
      } catch (error) {
          console.error('Error checking subclass of cell:', error);
          return false;
      }
  }

  async function isSubclassOfAnatomicalEntity(item) {
      const query = `
      ASK {
          wd:${item} wdt:P279* wd:Q27043950 .
      }
      `;
      const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query) + '&format=json';
      try {
          const response = await fetch(url);
          const data = await response.json();
          return data.boolean;
      } catch (error) {
          console.error('Error checking subclass of anatomical entity:', error);
          return false;
      }
  }

  function addNTRButton(itemId, ontology, createNTRBody) {
      var button = new OO.ui.ButtonWidget({
          label: `Add a NTR to ${ontology}`,
          flags: ['progressive'] // Optional: adds a visual cue that this is a primary action
      });
      button.on('click', function() {
          fetchAndFormatData(itemId, ontology).then(result => displayFormattedResult(result, ontology, createNTRBody));
      });
      $('.mw-indicators').append(button.$element);
  }

  function addImageButton(itemId) {
      var imageButton = new OO.ui.ButtonWidget({
          label: 'Add image to CL',
          flags: ['progressive'] // Optional: adds a visual cue that this is a primary action
      });
      imageButton.on('click', function() {
          createImageIssueForCL(itemId);
      });
      $('.mw-indicators').append(imageButton.$element);
  }

  // Function to fetch image data
  async function fetchCLIdAndImage(item) {
      const query = `
      SELECT ?cl_id ?image ?label WHERE {
          wd:${item} wdtn:P7963 ?cl_id . 
          wd:${item} rdfs:label ?label . 
          FILTER(LANG(?label) = "en")
          OPTIONAL { wd:${item} wdt:P18 ?image. }
      }
      `;
      const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query) + '&format=json';
      try {
          const response = await fetch(url);
          const data = await response.json();
          console.log('Data:', data.results.bindings);
          return data.results.bindings;
      } catch (error) {
          console.error('Error fetching CL ID and image data:', error);
          return [];
      }
  }

  async function createImageIssueForCL(item) {
      const results = await fetchCLIdAndImage(item);
      if (results.length === 1 && results[0].image) {
          // Construct the KGCL command
          const kgclCommand = `\`\`\`
          Hey ontobot! apply: - create edge ${results[0].cl_id.value} <http://xmlns.com/foaf/0.1/depicted_by> "${results[0].image.value}"^^xsd:anyURI
          \`\`\``;

          // Construct GitHub issue body
          const body = `
**Request to add a new image axiom with KGCL**

**Wikidata item:** [${results[0].label.value}](https://www.wikidata.org/entity/${item})
**CL ID:** ${results[0].cl_id.value}
**Image URL:** ${results[0].image.value}

${kgclCommand}

**Additional notes or concerns:**
This request was autogenerated from Wikidata.
          `;

          const url = newGithubIssueUrl({
              user: 'obophenotype',
              repo: 'cell-ontology',
              body: body,
              title: `[KGCL] New Image Axiom Request for ${results[0].label.value}`,
              labels: [`KGCL`, `ontobot`, `image+axiom+request`, `from+wikidata`]
          });

          window.open(url, '_blank');
      } else if (results.length !== 1) {
          alert('No unique CL match found for this item on Wikidata.');
      } else {
          alert('No image found for this item on Wikidata.');
      }
  }

  async function fetchAndFormatData(item, ontology) {
      const query = `
      SELECT ?itemLabel (GROUP_CONCAT(DISTINCT ?itemAltLabel; separator = ", ") AS ?aliases)
          (SAMPLE(?referenceTitle) AS ?referenceTitle) (SAMPLE(?pubMedID) AS ?pubMedID)
          (GROUP_CONCAT(DISTINCT ?superclassLabel;separator=", ") AS ?superclasses)
          (SAMPLE(?superclassUberonId) AS ?superclassUberonId)
          (GROUP_CONCAT(DISTINCT ?clId;separator=", ") AS ?clIds)
          (GROUP_CONCAT(DISTINCT ?anatomicalLocationLabel;separator=", ") AS ?anatomicalLocations)
          (SAMPLE(?anatomicalUberonId) AS ?anatomicalUberonId)
          ?wikipediaUrl
      WHERE {
      BIND(wd:${item} AS ?item)
      OPTIONAL { ?item skos:altLabel ?itemAltLabel. FILTER(LANG(?itemAltLabel) = "en") }
      ?item p:P31 ?statement.
      ?statement ps:P31 ?whatever.
      OPTIONAL {
        ?statement prov:wasDerivedFrom ?ref.
        ?ref pr:P248 ?reference.
        ?reference rdfs:label ?referenceTitle. FILTER(LANG(?referenceTitle) = "en")
        OPTIONAL { ?reference wdt:P698 ?pubMedID. }
      }
      OPTIONAL {
        ?item wdt:P279 ?superclass.
        ?superclass rdfs:label ?superclassLabel. FILTER(LANG(?superclassLabel) = "en")
        OPTIONAL { ?superclass wdt:P1554 ?superclassUberonId. }
        OPTIONAL { ?superclass wdt:P7963 ?clId. }
      }
      OPTIONAL {
        ?item wdt:P927 ?anatomicalLocation.
        ?anatomicalLocation rdfs:label ?anatomicalLocationLabel. FILTER(LANG(?anatomicalLocationLabel) = "en")
        OPTIONAL { ?anatomicalLocation wdt:P1554 ?anatomicalUberonId. }
      }
      OPTIONAL {
        ?wikipediaUrl schema:about ?item;
                schema:inLanguage "en";
                schema:isPartOf <https://en.wikipedia.org/>.
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
      GROUP BY ?itemLabel ?wikipediaUrl
      `;
      const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query) + '&format=json';
      try {
          const response = await fetch(url);
          const data = await response.json();
          return data.results.bindings[0] || {};
      } catch (error) {
          console.error('Error fetching data:', error);
          return {};
      }
  }

  // Adapted from https://github.com/sindresorhus/new-github-issue-url/tree/main
  function newGithubIssueUrl(options = {}) {
      let repoUrl = `https://github.com/${options.user}/${options.repo}`;
      const url = new URL(`${repoUrl}/issues/new`);
      const types = ['body', 'title', 'labels', 'template', 'milestone', 'assignee', 'projects'];

      for (const type of types) {
          let value = options[type];
          if (value === undefined) {
              continue;
          }

          if (type === 'labels' || type === 'projects') {
              if (!Array.isArray(value)) {
                  console.error(`The \`${type}\` option should be an array`);
                  continue;
              }
              value = value.join(',');
          }

          url.searchParams.set(type, value);
      }

      return url.toString();
  }

  function displayFormattedResult(result, ontology, createNTRBody) {
      const { itemLabel, aliases, referenceTitle, pubMedID, superclasses, superclassUberonId, clIds, anatomicalLocations, anatomicalUberonId, wikipediaUrl } = result;
      const item = getItemId();
      const wikidataLink = `https://www.wikidata.org/wiki/${item}`;
      const clIdsArray = clIds ? clIds.value.split(', ') : [];
      const formattedClIds = clIdsArray.map(id => `[${id}](http://purl.obolibrary.org/obo/${id.replace(':', '_')})`).join(', ');
      const formattedSuperclassUberonId = superclassUberonId ? `[UBERON:${superclassUberonId.value.replace(':', '_')}](http://purl.obolibrary.org/obo/UBERON_${superclassUberonId.value.replace(':', '_')})` : 'N/A';
      const formattedAnatomicalUberonId = anatomicalUberonId ? `[UBERON:${anatomicalUberonId.value.replace(':', '_')}](http://purl.obolibrary.org/obo/UBERON_${anatomicalUberonId.value.replace(':', '_')})` : 'N/A';
      const formattedPubMedID = pubMedID ? `[PMID:${pubMedID.value}](https://pubmed.ncbi.nlm.nih.gov/${pubMedID.value})` : '';

      const body = createNTRBody({
          itemLabel: itemLabel ? itemLabel.value : 'N/A',
          aliases: aliases ? aliases.value : 'None',
          referenceTitle: referenceTitle ? referenceTitle.value : 'No reference found',
          pubMedID: formattedPubMedID,
          superclasses: superclasses ? superclasses.value : 'N/A',
          superclassUberonId: formattedSuperclassUberonId,
          clIds: formattedClIds,
          anatomicalLocations: anatomicalLocations ? anatomicalLocations.value : 'N/A',
          anatomicalUberonId: formattedAnatomicalUberonId,
          wikipediaUrl: wikipediaUrl ? wikipediaUrl.value : 'No reference found',
          wikidataLink: wikidataLink
      });

      const url = newGithubIssueUrl({
          user: 'obophenotype',
          repo: ontology === 'CL' ? 'cell-ontology' : 'uberon',
          body: body,
          title: `[NTR] New Term Request: ${itemLabel ? itemLabel.value : ''}`,
          labels: [`new+term+request`, `from+wikidata`]
      });

      window.open(url, '_blank');
  }

  function createCLNTRBody({itemLabel, aliases, referenceTitle, pubMedID, superclasses, clIds, anatomicalLocations, anatomicalUberonId, wikipediaUrl, wikidataLink}) {
      return `**Preferred term label**
      
*${itemLabel}*

**Synonyms**
${aliases}

**Definition**
A ${superclasses} that... **FILL HERE**

References:
${referenceTitle}
${pubMedID}
${wikipediaUrl}

**Parent cell type term**
${superclasses}
CL IDs: ${clIds}

**Anatomical structure where the cell type is found**
${anatomicalLocations}
Uberon IDs: ${anatomicalUberonId}

**Your ORCID**
https://orcid.org/0000-0003-2473-2313

**Additional notes or concerns**
The draft for this request was autogenerated from Wikidata. For more details, see the [Wikidata item](${wikidataLink}) or the [source script](https://www.wikidata.org/wiki/User:TiagoLubiana/cell-ontology.js).
      `;
  }

  function createUberonNTRBody({itemLabel, aliases, referenceTitle, pubMedID, superclasses, superclassUberonId, anatomicalLocations, anatomicalUberonId, wikipediaUrl, wikidataLink}) {
      return `**Preferred term label:**
      
*${itemLabel}*

**Synonyms**
${aliases}

**Definition**
${pubMedID}

**Parent term**
${superclasses}
UBERON ID: ${superclassUberonId}

**Anatomical structure where the term is found**
${anatomicalLocations}
UBERON ID: ${anatomicalUberonId}

**Your nano-attribution**
https://orcid.org/0000-0003-2473-2313

**Link back to Wikidata item**
${wikidataLink}
      `;
  }

})();
