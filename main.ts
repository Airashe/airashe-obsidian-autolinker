import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TextComponent } from 'obsidian';

export class AliasData
{
	link: string;
	aliases: string[]
}

interface AirasheAutolinkerSettings {
	autoscan_check_interval: number;
	autoscan_active_document: boolean;
	ignore_headers: boolean;
	links: AliasData[];
}

const DEFAULT_SETTINGS: AirasheAutolinkerSettings = {
	autoscan_check_interval: 2000,
	autoscan_active_document: true, 
	ignore_headers: true,
	links: []
}

export default class AirasheAutolinkerPlugin extends Plugin {
	settings: AirasheAutolinkerSettings;
	last_length: number = 0;
	last_change_dt: number;
	scanned: boolean;
	ordered_links: any[] = [];
	aliases_dirty: boolean;

	async onload() {
		this.aliases_dirty = true;
		this.last_change_dt = Date.now();
		this.scanned = false;
		await this.loadSettings();
		this.registerInterval(window.setInterval(() => {
			if (!this.settings.autoscan_active_document)
				return;
			
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view)
				return;
	
			if (this.last_length != view.data.length)
			{
				this.last_change_dt = Date.now();
				this.scanned = false;
			}
	
			this.last_length = view.data.length;
			if (Date.now() - this.last_change_dt < this.settings.autoscan_check_interval || this.scanned)
				return;
	
			view.setViewData(this.scanDocument(view.data), false);
			this.scanned = true;
		}, this.settings.autoscan_check_interval / 2));
		
		this.addSettingTab(new AirasheAutolinkerSettingsTab(this.app, this));

		this.addCommand({
			id: 'airashe-autolinker-scan-note', 
			name: 'Autolink current note', 
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (!view)
					return;

				view.setViewData(this.scanDocument(view.data), false);
			}
		});

		this.addCommand({
			id: 'airashe-autolinker-autolink-selection', 
			name: 'Autolink selection', 
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (!view)
					return;

				const selection = editor.getSelection();
				editor.replaceSelection(this.scanDocument(selection));
				const currentpos = editor.getCursor();
				try
				{
					editor.setCursor(currentpos.line, currentpos.ch + 1);
				}
				catch{}
			}
		});

		this.addCommand({
			id: 'airashe-autolinker-add-alias',
			name: 'Add autolink to glossary', 
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (!view)
					return;

				const selection = editor.getSelection();
				const link_regex = new RegExp('\\[\\[(.*)\\|(.*)\\]\\]', 'gmi');

				const link_data = link_regex.exec(selection);
				if(!link_data)
				{
					new Notice('Link not selected');
					return;
				}

				const link = link_data[1];
				const alias = link_data[2];
				
				for(const existing_link of this.settings.links)
				{
					if (existing_link.link == link)
					{
						for(const existing_alias of existing_link.aliases)
						{
							if (existing_alias == alias)
							{
								new Notice(`Alias already exists`);
								return;
							}
						}
						existing_link.aliases.push(alias);
						await this.saveSettings();
						new Notice(`Alias ${alias} added to existing link ${link}`);
						this.aliases_dirty = true;
						return;
					}
				}

				this.settings.links.push({link: link, aliases: [alias]});
				await this.saveSettings();
				new Notice(`Alias ${alias} added to link ${link}`);
				this.aliases_dirty = true;
			}
		});

		this.addCommand({
			id: 'airashe-autolinker-remove-alias',
			name: 'Remove autolink from glossary',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (!view)
					return;

				const selection = editor.getSelection();
				const link_regex = new RegExp('\\[\\[(.*)\\|(.*)\\]\\]', 'gmi');

				const link_data = link_regex.exec(selection);
				if(!link_data)
				{
					new Notice('Link not selected');
					return;
				}

				const link = link_data[1];
				const alias = link_data[2];
				
				for(const existing_link of this.settings.links)
				{
					if (existing_link.link == link)
					{
						for(const existing_alias of existing_link.aliases)
						{
							if (existing_alias == alias)
							{
								existing_link.aliases.splice(existing_link.aliases.indexOf(alias), 1);
								if (existing_link.aliases.length == 0)
								{
									this.settings.links.splice(this.settings.links.indexOf(existing_link), 1);
									new Notice(`Link ${link} removed due to 0 aliases`);
								}
								else
								{
									new Notice(`Alias ${alias} removed from link ${link}`);
								}
								this.aliases_dirty = true;
								await this.saveSettings();
								return;
							}
						}
					}
				}
			}
		})
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	scanDocument(document: string) {
		if (this.aliases_dirty)
		{
			this.ordered_links = this.settings.links.map(data => {
				return data.aliases.map(al => {
					return {alias: al, link: data.link};
				});
			}).flat().sort((left, right) => {
					if (left.alias.length > right.alias.length)
						return -1;
					if (left.alias.length < right.alias.length)
						return 1;
					return 0;
				});
			this.aliases_dirty = false;
		}
		for(const link_data of this.ordered_links)
		{
			let alias_reg: RegExp;
			if (!this.settings.ignore_headers) {
				alias_reg = new RegExp('^(.*)((?<!\\[\\[)' + link_data.alias +'(?!.*((\\|)|(\\]\\]))))', 'gmi');
				document = document.replace(alias_reg, '$1[[' + link_data.link + '|$2]]');
			}
			else {
				alias_reg = new RegExp('^(?!#)(.*)((?<!\\[\\[)' + link_data.alias  +'(?!.*((\\|)|(\\]\\]))))', 'gmi');
				document = document.replace(alias_reg, '$1[[' + link_data.link + '|$2]]');
			}
		}
		return document;
	}
}

class AirasheAutolinkerSettingsTab extends PluginSettingTab {
	plugin: AirasheAutolinkerPlugin;
	add_link_name: string;
	add_link_aliases: string;
	search_filter: string;

	constructor(app: App, plugin: AirasheAutolinkerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.search_filter = '';
	}

	_p_redraw(focus_search: boolean = false, area_indx: number = -1, clear_new_link: boolean = false): void
	{
		if (clear_new_link)
		{
			this.add_link_name = '';
			this.add_link_aliases = '';
		}
		const { containerEl } = this;

		containerEl.empty();
		new Setting(containerEl)
			.setName('Autolink active note')
			.setDesc('Automatically scan current note for aliases and replaces with links')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.autoscan_active_document)
				.onChange(async (value) => {
					this.plugin.settings.autoscan_active_document = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Ignore headers')
			.setDesc('Ignore headers when scanning for autolinks')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.ignore_headers)
				.onChange(async (value) => {
					this.plugin.settings.ignore_headers = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Autolink check interval')
			.setDesc('How often to check for new links in current note')
			.addText((text) => text.setValue(this.plugin.settings.autoscan_check_interval.toString()).onChange(async (value) => {
				this.plugin.settings.autoscan_check_interval = parseInt(value);
				await this.plugin.saveSettings();
			}));

		containerEl.createEl('h2', {text: 'Links glossary'});
		// new link
		new Setting(containerEl)
			.setName('Add link')
			.setDesc('Add new link')
			.addText((text) => text.setValue(this.add_link_name).setPlaceholder('link#sublink')
				.onChange(async (value) => {
					this.add_link_name = value;
				})
			).addTextArea((area => area.setValue(this.add_link_aliases).setPlaceholder('["alias1", "alias2"]')
				.onChange(async (value) => {
					this.add_link_aliases = value;
				}))
			).addButton((btn) => btn.setButtonText('Add').setCta().onClick(async () => {
				const link = {link: this.add_link_name, aliases: JSON.parse(this.add_link_aliases)};
				this.plugin.settings.links.push(link);
				await this.plugin.saveSettings();
				this._p_redraw(false, -1, true);
			}));
		
		// list of all links.
		let searchEl: any;
		new Setting(containerEl).setName("Search links").setDesc(`Links in list: ${this.plugin.settings.links.length}`).addSearch((search) => searchEl = search.setValue(this.search_filter).onChange(async (value) => {
			this.search_filter = value;
			this._p_redraw(true);
		}).inputEl);
		if (focus_search)
			searchEl.focus();
		
		let linkIndex = 0;
		let link_setting_area: any;
		for(const link of this.plugin.settings.links)
		{
			if (link.link.toLocaleLowerCase().includes(this.search_filter.toLocaleLowerCase()) || !this.search_filter)
			{
				let link_setting_el = new Setting(containerEl)
				.setName(`${link.link}`)
				.setDesc(link.aliases.join(', '))
				.addTextArea((area) => {
					area.setValue(JSON.stringify(link.aliases))
					.onChange(async (value) => {
						try
						{
							link.aliases = JSON.parse(value);
							await this.plugin.saveSettings();
							this._p_redraw(false, Number.parseInt(area.inputEl.getAttr('inp_idx') ?? "-1"));
						} catch{}
					}).inputEl.setAttr('inp_idx', linkIndex);
					if (area_indx == linkIndex)
						link_setting_area = area.inputEl;
				}).addButton((btn) => btn.setButtonText('Remove').setWarning().onClick(async () => {
					this.plugin.settings.links.splice(this.plugin.settings.links.indexOf(link), 1);
					await this.plugin.saveSettings();
					this._p_redraw();
				}));
			}
			linkIndex++;
		}
		if (link_setting_area)
			link_setting_area.focus();
	}

	display(): void {
		this._p_redraw();
	}
}
