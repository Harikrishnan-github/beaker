/* globals beaker */

import yo from 'yo-yo'
import {pluralize} from '../../lib/strings'
import {pushUrl} from '../../lib/fg/event-handlers'
import * as createWorkspacePopup from '../com/create-workspace-popup'
import renderSidebar from '../com/sidebar'
import renderDiff from '../com/diff'
import renderGearIcon from '../icon/gear-small'
import * as toast from '../com/toast'

// main
// =
let allWorkspaces = []
let currentWorkspaceName
let tmpWorkspaceName
let workspaceInfo
let diff
let diffAdditions = 0
let diffDeletions = 0
let currentDiffNode
let numCheckedRevisions
let activeTab = 'revisions'

// HACK FIX
// the good folk of whatwg didnt think to include an event for pushState(), so let's add one
// -prf
var _wr = function (type) {
  var orig = window.history[type]
  return function () {
    var rv = orig.apply(this, arguments)
    var e = new Event(type.toLowerCase())
    e.arguments = arguments
    window.dispatchEvent(e)
    return rv
  }
}
window.history.pushState = _wr('pushState')
window.history.replaceState = _wr('replaceState')

setup()
async function setup () {
  allWorkspaces = await beaker.workspaces.list(0)
  // add extra metadata to the workspaces
  await Promise.all(allWorkspaces.map(async (w) => {
    const revisions = await beaker.workspaces.listChangedFiles(0, w.name, {shallow: true}).length
    w.numRevisions = revisions ? revisions.length : 0
    return w
  }))
  await loadCurrentWorkspace()

  window.addEventListener('pushstate', loadCurrentWorkspace)
  window.addEventListener('popstate', loadCurrentWorkspace)

  render()
}

async function loadCurrentWorkspace () {
  currentWorkspaceName = parseURLWorkspaceName()
  tmpWorkspaceName = currentWorkspaceName
  if (currentWorkspaceName) {
    workspaceInfo = await beaker.workspaces.get(0, currentWorkspaceName)
    if (workspaceInfo) workspaceInfo.revisions = await beaker.workspaces.listChangedFiles(0, currentWorkspaceName, {shallow: true, compareContent: true})
  } else {
    workspaceInfo = null
  }

  // set the current diff node to the first revision
  if (workspaceInfo && workspaceInfo.revisions.length) {
    const firstRev = workspaceInfo.revisions[0]
    currentDiffNode = firstRev
    await loadCurrentDiff(firstRev)
  }
  render()
}

async function loadCurrentDiff (revision) {
  if (!revision) {
    diff = ''
    currentDiffNode = null
    diffAdditions = 0
    diffDeletions = 0
    return
  }

  // fetch the diff
  diff = await beaker.workspaces.diff(0, currentWorkspaceName, revision.path)

  diffDeletions = diff.reduce((sum, el) => {
    if (el.removed) return sum + el.count
    return sum
  }, 0)

  diffAdditions = diff.reduce((sum, el) => {
    if (el.added) return sum + el.count
    return sum
  }, 0)
}

function parseURLWorkspaceName () {
  return window.location.pathname.replace(/\//g, '')
}

// events
// =

async function onCreateWorkspace () {
  const {name, url, path} = await createWorkspacePopup.create()
  await beaker.workspaces.set(0, name, {localFilesPath: path, publishTargetUrl: url})
  allWorkspaces = await beaker.workspaces.list(0)
  history.pushState({}, null, `beaker://workspaces/${name}`)
  // TODO: we should tell the user if a workspace name is already in use, so
  // they don't accidentally overwrite an existing workspace -tbv
}

async function onRemoveWorkspace (name) {
  await beaker.workspaces.remove(0, name)
  allWorkspaces = await beaker.workspaces.list(0)
  currentWorkspaceName = ''
  workspaceInfo = null
  render()
}

async function onPublishChanges () {
  let changes = workspaceInfo.revisions
  if (numCheckedRevisions) {
    changes = changes.filter(rev => !!rev.checked)
  }
  const paths = changes.map(rev => rev.path)

  if (!confirm(`Publish ${paths.length} ${pluralize(paths.length, 'change')}?`)) return
  await beaker.workspaces.publish(0, currentWorkspaceName, {paths})
  await loadCurrentDiff(null)
  loadCurrentWorkspace()
}

async function onRevertChanges () {
  let changes = workspaceInfo.revisions
  if (numCheckedRevisions) {
    changes = changes.filter(rev => !!rev.checked)
  }
  const paths = changes.map(rev => rev.path)

  if (!confirm(`Revert ${paths.length} ${pluralize(paths.length, 'change')}?`)) return
  await beaker.workspaces.revert(0, currentWorkspaceName, {paths})
  await loadCurrentDiff(null)
  loadCurrentWorkspace()
}

function onOpenFolder (path) {
  beaker.workspaces.openFolder(path)
}

function onChangeTab (tab) {
  activeTab = tab
  render()
}

function onChangeWorkspaceName (e) {
  tmpWorkspaceName = e.target.value
  render()
}

async function onSaveWorkspaceName () {
  await beaker.workspaces.set(0, workspaceInfo.name, {name: tmpWorkspaceName})
  toast.create(`Workspace name updated to ${tmpWorkspaceName}`)
  history.pushState({}, null, `beaker://workspaces/${tmpWorkspaceName}`)
}

async function onChangeWorkspaceDirectory (e) {
  const path = e.target.files[0].path
  workspaceInfo.localFilesPath = path
  await beaker.workspaces.set(0, workspaceInfo.name, {localFilesPath: path})
  toast.create(`Workspace directory updated to ${path}`)
  render()
}

function onToggleChangedNodeChecked (e, node) {
  e.stopPropagation()
  node.checked = !node.checked
  numCheckedRevisions = workspaceInfo.revisions.filter(r => !!r.checked).length
  render()
}

async function onClickChangedNode (node) {
  currentDiffNode = node
  await loadCurrentDiff(node)
  render()
}

// rendering
// =

function render () {
  if (currentWorkspaceName.length && !workspaceInfo) render404()
  else if (!workspaceInfo) renderWorkspacesListing()
  else renderWorkspace()
}

function renderWorkspacesListing () {
  yo.update(document.querySelector('.workspaces-wrapper'), yo`
    <div class="builtin-wrapper workspaces-wrapper listing">
      ${renderSidebar('')}
      <div>
        <div class="builtin-sidebar">
          <h1>Workspaces</h1>

          <p>Manage your workspaces</p>
        </div>

        <div class="builtin-main">
          <div class="builtin-header fixed">
            <div class="actions">
              <button class="btn" onclick=${onCreateWorkspace} >
                New workspace
                <i class="fa fa-plus"></i>
              </button>
            </div>
          </div>

          <div>
            <ul class="workspaces">
              ${allWorkspaces.map(renderWorkspaceListItem)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  `)
}

function renderWorkspaceListItem (workspace) {
  return yo`
    <li class="workspace">
      <div>
        <img class="favicon" src="beaker-favicon:${workspace.publishTargetUrl}" />
        <span class="info">
          <a class="title" href="workspace://${workspace.name}">
            <code>workspace://${workspace.name}</code>
          </a>

          <div class="metadata">
            ${workspace.numRevisions} ${pluralize(workspace.numRevisions, 'unpublished change')}
            <span class="bullet">•</span>
            <code class="path" onclick=${e => onOpenFolder(workspace.localFilesPath)}>
              ${workspace.localFilesPath}
            </code>
          </div>
        </span>
      </div>

      <div class="buttons">
        <button class="btn transparent remove-workspace" title="Remove this workspace" onclick=${e => onRemoveWorkspace(workspace.name)}>
          <i class="fa fa-trash-o"></i>
        </button>

        <a class="btn" href=${'beaker://workspaces/' + workspace.name} onclick=${pushUrl}>
          Open workspace
        </a>

        <a title="Preview changes" href="workspace://${workspace.name}" class="btn">
          <i class="fa fa-external-link"></i>
        </a>
      </div>
    </li>
  `
}

function renderWorkspace () {
  yo.update(document.querySelector('.workspaces-wrapper'), yo`
    <div class="workspaces-wrapper builtin-wrapper workspace">
      ${renderHeader()}
      ${renderView()}
    </div>
  `)
}

function render404 () {
  yo.update(document.querySelector('.workspaces-wrapper'), yo`
    <div class="workspaces-wrapper not-found">
      <span class="name">workspace://${currentWorkspaceName}</span> does not exist

      <div class="links">
        <span onclick=${() => history.pushState({}, null, 'beaker://workspaces')}>
          « Back to all workspaces
        </span>
      </div>
    </div>
  `)
}

function renderHeader () {
  return yo`
    <div class="header">
      <div class="top">
        <div>
          <a href="workspace://${workspaceInfo.name}" class="name">workspace://${workspaceInfo.name}</a>
          <span onclick=${e => onOpenFolder(workspaceInfo.localFilesPath)} class="local-path">
            ${workspaceInfo.localFilesPath}
          </span>
        </div>

        ${renderActions()}
      </div>

      <div class="bottom">
        ${renderTabs()}
        ${renderMetadata()}
      </div>
    </div>
  `
}

function renderTabs () {
  return yo`
    <div class="tabs">
      <div onclick=${e => onChangeTab('revisions')} class="tab ${activeTab === 'revisions' ? 'active' : ''}">
        <i class="fa fa-code"></i>
        Revisions
      </div>
      <div onclick=${e => onChangeTab('wizards')} class="tab ${activeTab === 'wizards' ? 'active' : ''}">
        <i class="fa fa-cube"></i>
        Wizards
      </div>
      <div onclick=${e => onChangeTab('settings')} class="tab ${activeTab === 'settings' ? 'active' : ''}">
        <i class="fa fa-cogs"></i>
        Settings
      </div>
    </div>
  `
}

function renderActions () {
  return yo`
    <div class="actions">
      <button onclick=${onRevertChanges} class="btn" disabled=${!(workspaceInfo && workspaceInfo.revisions.length)}>
        Revert${numCheckedRevisions ? ' selected' : ''}
        <i class="fa fa-undo"></i>
      </button>
      <button onclick=${onPublishChanges} class="btn success" disabled=${!(workspaceInfo && workspaceInfo.revisions.length)}>
        Publish${numCheckedRevisions ? ' selected' : ''}
      </button>
    </div>
  `
}

function renderMetadata () {
  return yo`
    <div class="metadata">
      ${workspaceInfo.revisions.length ? yo`
        <span class="changes-count">
          ${workspaceInfo.revisions.length} unpublished ${pluralize(workspaceInfo.revisions.length, 'change')}
          ${numCheckedRevisions ? `(${numCheckedRevisions} selected)` : ''}
        </span>
      ` : ''}
    </div>
  `
}

function renderView () {
  switch (activeTab) {
    case 'revisions':
      return renderRevisionsView()
    case 'wizards':
      return renderWizardsView()
    case 'settings':
      return renderSettingsView()
    default:
      return yo`<div class="view">Loading...</div>`
  }
}

function renderRevisionsView () {
  const additions = workspaceInfo.revisions.filter(r => r.change === 'add')
  const modifications = workspaceInfo.revisions.filter(r => r.change === 'mod')
  const deletions = workspaceInfo.revisions.filter(r => r.change === 'del')

  const renderRev = node => (
    yo`<li onclick=${() => onClickChangedNode(node)} title=${node.path}>
      <code class="path">${node.type === 'file' ? node.path.slice(1) : node.path}</code>
      <input
        type="checkbox"
        checked=${!!node.checked}
        onclick=${e => onToggleChangedNodeChecked(e, node)}
      />
    </li>`
  )

  return yo`
    <div class="view revisions">
      <div class="revisions-sidebar">
        ${additions.length ? yo`
          <div>
            <div class="revisions-header additions">
              <h3>Additions</h3>
              <span class="count">${additions.length}</span>
            </div>

            <ul class="revisions-list">
              ${additions.map(renderRev)}
            </ul>
          </div>
        ` : ''}

        ${modifications.length ? yo`
          <div>
            <div class="revisions-header modifications">
              <h3>Modifications</h3>
              <span class="count">${modifications.length}</span>
            </div>

            <ul class="revisions-list">
              ${modifications.map(renderRev)}
            </ul>
          </div>
        ` : ''}

        ${deletions.length ? yo`
          <div>
            <div class="revisions-header deletions">
              <h3>Deletions</h3>
              <span class="count">${deletions.length}</span>
            </div>

            <ul class="revisions-list">
              ${deletions.map(renderRev)}
            </ul>
          </div>
        ` : ''}
        ${!(additions.length || modifications.length || deletions.length)
          ? yo`<em>No revisions</em>`
          : ''}
      </div>

      <div class="revisions-content">
        ${currentDiffNode ? yo`
          <div class="revisions-content-header">
            <div>
              <i class="fa fa-file-text-o"></i>
              <code class="path">
                ${currentDiffNode.type === 'file' ? currentDiffNode.path.slice(1) : currentDiffNode.path}
              </code>
            </div>

            <div class="changes-count-container">
              <span class="additions-count">${diffAdditions ? `+${diffAdditions}` : ''}</span>
              <span class="deletions-count">${diffDeletions ? `-${diffDeletions}` : ''}</span>
          </div>
        ` : ''}

        ${diff ? renderDiff(diff) : ''}
      </div>
    </div>
  `
}

function renderWizardsView () {
  return yo`
    <div class="view">
      TODO
    </div>
  `
}

function renderSettingsView () {
  return yo`
    <div class="view settings">
      <h2>Settings</h2>

      <div class="input-group">
        <label for="name">Local URL</label>
        <p>
          The shortcut for previewing your workspace
        </p>

        <div class="name-input-container">
          <span class="protocol">workspaces://</span>
          <input onkeyup=${onChangeWorkspaceName} name="name" value=${tmpWorkspaceName}/>

          ${tmpWorkspaceName !== workspaceInfo.name ? yo`
            <button class="btn primary" onclick=${onSaveWorkspaceName}>
              Save
              <i class="fa fa-check"></i>
            </button>`
          : ''}
        </div>
      </div>

      <div>
        <label>Directory</label>
        <p>
          The directory on your computer that contains your workspace's files
        </p>

        <label for="path" class="btn" data-path=${workspaceInfo.localFilesPath}>
          Select directory
        </label>
        <input id="path" name="path" type="file" webkitdirectory onchange=${onChangeWorkspaceDirectory}>
      </div>
    </div>
  `
}