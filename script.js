// Simple Workflow Builder
class WorkflowBuilder {
    constructor() {
        this.nodes = [];
        this.connections = [];
        this.nodeCounter = 0;
        this.isConnecting = false;
        this.connectionStart = null;
        this.tempLine = null;
        this.authToken = window._authToken || null;
        this.user = null;
        this.contacts = [];
        this.init();
        console.log('🔧 WorkflowBuilder initialized with token:', this.authToken ? 'YES' : 'NO');
    }

    init() {
        this.setupEventListeners();
        this.addStartNode();
    }

    setupEventListeners() {
        // Component drag from sidebar
        document.querySelectorAll('.component-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', e.target.dataset.type);
            });
        });

        // Canvas drop zone
        const canvas = document.getElementById('workflowCanvas');
        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const nodeType = e.dataTransfer.getData('text/plain');
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.addNode(nodeType, x, y);
        });

        // Canvas controls
        document.getElementById('zoomIn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOut').addEventListener('click', () => this.zoomOut());
        document.getElementById('undo').addEventListener('click', () => this.undo());
        document.getElementById('redo').addEventListener('click', () => this.redo());
        document.getElementById('refresh').addEventListener('click', () => this.refresh());

        // Config panel
        document.getElementById('closeConfig').addEventListener('click', () => this.closeConfigPanel());

        // Run Workflow button
        document.getElementById('runWorkflowBtn').addEventListener('click', () => this.runWorkflow());

        // Save/Load Cadence buttons
        document.getElementById('saveCadenceBtn').addEventListener('click', () => this.saveCadence());
        document.getElementById('loadCadenceBtn').addEventListener('click', () => this.loadCadence());

        // Navigation tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                console.log('🔘 Tab clicked:', tab.dataset.view);
                this.switchView(tab.dataset.view);
            });
        });
        
        // Refresh contacts button (might not exist yet)
        const refreshBtn = document.getElementById('refreshContactsBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadContacts());
        }
        
        // Listen for contact additions from extension
        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'CADENCEFLOW_CONTACT_ADDED') {
                console.log('📥 Contact added from extension, switching to contacts view');
                setTimeout(() => {
                    this.switchView('contacts');
                }, 500);
            }
        });
    }

    // Authentication methods

    login() {
        window.location.href = 'http://localhost:3000/auth/google';
    }

    logout() {
        localStorage.removeItem('authToken');
        this.authToken = null;
        this.user = null;
        this.showLogin();
    }

    showLogin() {
        document.getElementById('loginBtn').style.display = 'block';
        document.getElementById('logoutBtn').style.display = 'none';
        document.getElementById('saveCadenceBtn').style.display = 'none';
        document.getElementById('loadCadencesBtn').style.display = 'none';
        document.getElementById('startCadenceBtn').style.display = 'none';
    }

    showAuthenticated() {
        document.getElementById('loginBtn').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'block';
        document.getElementById('saveCadenceBtn').style.display = 'block';
        document.getElementById('loadCadencesBtn').style.display = 'block';
        document.getElementById('startCadenceBtn').style.display = 'block';
    }

    async fetchUser() {
        try {
            const response = await fetch('http://localhost:3000/api/user', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (response.ok) {
                this.user = await response.json();
                this.showAuthenticated();
                this.loadContacts();
            } else {
                this.showLogin();
            }
        } catch (error) {
            console.error('Error fetching user:', error);
            this.showLogin();
        }
    }

    async loadContacts() {
        try {
            const response = await fetch('http://localhost:3000/api/contacts', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (response.ok) {
                this.contacts = await response.json();
            }
        } catch (error) {
            console.error('Error loading contacts:', error);
        }
    }

    async saveCadence() {
        alert('Save cadence button clicked!');
        console.log('Save cadence clicked, authToken:', this.authToken);
        
        if (!this.authToken) {
            alert('Please login first');
            return;
        }

        console.log('Current nodes:', this.nodes);
        console.log('Current connections:', this.connections);
        
        // Validate that workflow starts with a Start node
        const hasStartNode = this.nodes.some(node => node.type === 'start');
        if (!hasStartNode) {
            alert('Error: Every cadence must start with a Start node. Please add a Start node to your workflow.');
            return;
        }

        // Validate that Start node has connections
        const startNodes = this.nodes.filter(node => node.type === 'start');
        const hasStartConnections = startNodes.some(startNode => 
            this.connections.some(conn => conn.from === startNode.id)
        );
        
        if (!hasStartConnections) {
            alert('Error: The Start node must be connected to other nodes in your workflow.');
            return;
        }

        const name = prompt('Enter cadence name:');
        if (!name) return;

        try {
            console.log('Saving cadence:', { name, nodes: this.nodes, connections: this.connections });
            
            const response = await fetch('http://localhost:3000/api/cadences', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    name: name,
                    nodes: this.nodes,
                    connections: this.connections
                })
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Cadence saved:', result);
                alert('Cadence saved successfully!');
            } else {
                const errorData = await response.json();
                console.error('Error saving cadence:', errorData);
                alert('Error saving cadence: ' + (errorData.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error saving cadence:', error);
            alert('Error saving cadence: ' + error.message);
        }
    }

    async loadCadences() {
        if (!this.authToken) {
            alert('Please login first');
            return;
        }

        try {
            const response = await fetch('http://localhost:3000/api/cadences', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (response.ok) {
                const cadences = await response.json();
                this.showCadenceList(cadences);
            } else {
                alert('Error loading cadences');
            }
        } catch (error) {
            console.error('Error loading cadences:', error);
            alert('Error loading cadences');
        }
    }

    showCadenceList(cadences) {
        const cadenceList = cadences.map(cadence => 
            `<div class="cadence-item" onclick="workflowBuilder.loadCadence('${cadence.id}')">
                <h4>${cadence.name}</h4>
                <p>Created: ${new Date(cadence.created_at).toLocaleDateString()}</p>
            </div>`
        ).join('');

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Load Cadence</h3>
                    <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
                </div>
                <div class="modal-body">
                    ${cadenceList || '<p>No cadences found</p>'}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    async loadCadence(cadenceId) {
        try {
            const response = await fetch(`http://localhost:3000/api/cadences`, {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (response.ok) {
                const cadences = await response.json();
                const cadence = cadences.find(c => c.id == cadenceId);
                if (cadence) {
                    // Parse the JSON strings back to objects
                    this.nodes = typeof cadence.nodes === 'string' ? JSON.parse(cadence.nodes) : cadence.nodes;
                    this.connections = typeof cadence.connections === 'string' ? JSON.parse(cadence.connections) : cadence.connections;
                    this.rerenderWorkflow();
                    document.querySelector('.modal').remove();
                    alert('Cadence loaded successfully!');
                } else {
                    alert('Cadence not found');
                }
            } else {
                alert('Error loading cadence');
            }
        } catch (error) {
            console.error('Error loading cadence:', error);
            alert('Error loading cadence: ' + error.message);
        }
    }

    rerenderWorkflow() {
        document.getElementById('workflowNodes').innerHTML = '';
        this.nodes.forEach(node => this.renderNode(node));
        this.connections.forEach(connection => this.drawConnection(connection));
    }

    async startCadence() {
        if (!this.authToken) {
            alert('Please login first');
            return;
        }

        if (this.contacts.length === 0) {
            alert('Please add contacts first. Click "Add Contact" in the left sidebar.');
            return;
        }

        // Check if there's a workflow on the canvas
        if (this.nodes.length === 0) {
            alert('Please build a workflow first. Drag nodes from the left sidebar.');
            return;
        }

        // Check if there's a start node
        const hasStartNode = this.nodes.some(node => node.type === 'start');
        if (!hasStartNode) {
            alert('Your workflow needs a Start node!');
            return;
        }

        // Check if there are any email nodes
        const hasEmailNode = this.nodes.some(node => 
            node.type === 'email' || node.type === 'followup-email' || 
            node.type === 'followup-email2' || node.type === 'new-email'
        );
        if (!hasEmailNode) {
            alert('Your workflow needs at least one Email node!');
            return;
        }

        // Show contact selection
        const contactList = this.contacts.map(contact => 
            `<label style="display: block; margin: 10px 0;">
                <input type="checkbox" value="${contact.id}"> 
                ${contact.name} (${contact.email})
            </label>`
        ).join('');

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 12px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;">
                <h3 style="margin-top: 0;">Select Contacts for Cadence</h3>
                <form id="contactForm">
                    ${contactList}
                    <br>
                    <div style="display: flex; gap: 10px; margin-top: 20px;">
                        <button type="button" onclick="this.closest('.modal').remove()" style="padding: 10px 20px; border: 1px solid #ddd; background: white; border-radius: 6px; cursor: pointer;">Cancel</button>
                        <button type="button" onclick="workflowBuilder.executeCadence()" style="padding: 10px 20px; background: #4F46E5; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Start Sending</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);
    }

    async executeCadence() {
        const form = document.getElementById('contactForm');
        const selectedContacts = Array.from(form.querySelectorAll('input:checked')).map(cb => cb.value);
        
        if (selectedContacts.length === 0) {
            alert('Please select at least one contact');
            return;
        }

        console.log('🚀 Starting cadence with current workflow...');
        console.log('   Nodes:', this.nodes.length);
        console.log('   Connections:', this.connections.length);
        console.log('   Contacts:', selectedContacts.length);

        // Send the current workflow directly to start the cadence
        try {
            const response = await fetch('http://localhost:3000/api/cadences/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    nodes: this.nodes,
                    connections: this.connections,
                    contactIds: selectedContacts
                })
            });

            if (response.ok) {
                const result = await response.json();
                alert(`✅ Cadence started! ${result.emailsScheduled} emails scheduled.\n\nCheck the server logs to see emails being sent!`);
                document.querySelector('.modal').remove();
            } else {
                const errorData = await response.json();
                alert(`❌ Error starting cadence: ${errorData.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Error starting cadence:', error);
            alert('❌ Error starting cadence: ' + error.message);
        }
    }

    // Contact Management Methods
    showAddContactModal() {
        if (!this.authToken) {
            alert('Please login first');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Add New Contact</h3>
                    <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
                </div>
                <div class="modal-body">
                    <form id="addContactForm">
                        <div class="form-group">
                            <label for="contactName">Name *</label>
                            <input type="text" id="contactName" required placeholder="Enter contact name">
                        </div>
                        <div class="form-group">
                            <label for="contactEmail">Email *</label>
                            <input type="email" id="contactEmail" required placeholder="Enter email address">
                        </div>
                        <div class="form-group">
                            <label for="contactCompany">Company</label>
                            <input type="text" id="contactCompany" placeholder="Enter company name">
                        </div>
                        <div class="form-actions">
                            <button type="button" onclick="this.closest('.modal').remove()" class="btn btn-secondary">Cancel</button>
                            <button type="button" onclick="workflowBuilder.addContact()" class="btn btn-primary">Add Contact</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    async addContact() {
        const name = document.getElementById('contactName').value;
        const email = document.getElementById('contactEmail').value;
        const company = document.getElementById('contactCompany').value;

        if (!name || !email) {
            alert('Name and email are required');
            return;
        }

        try {
            const response = await fetch('http://localhost:3000/api/contacts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({ name, email, company })
            });

            if (response.ok) {
                alert('Contact added successfully!');
                document.querySelector('.modal').remove();
                this.loadContacts(); // Refresh contacts list
            } else {
                alert('Error adding contact');
            }
        } catch (error) {
            console.error('Error adding contact:', error);
            alert('Error adding contact');
        }
    }

    showContactsModal() {
        if (!this.authToken) {
            alert('Please login first');
            return;
        }

        const contactList = this.contacts.map(contact => 
            `<div class="contact-item">
                <div class="contact-info">
                    <h4>${contact.name}</h4>
                    <p>${contact.email}</p>
                    <small>${contact.company || 'No company'}</small>
                </div>
                <div class="contact-actions">
                    <button onclick="workflowBuilder.deleteContact(${contact.id})" class="btn btn-danger btn-sm">Delete</button>
                </div>
            </div>`
        ).join('');

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Contacts (${this.contacts.length})</h3>
                    <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
                </div>
                <div class="modal-body">
                    ${contactList || '<p>No contacts found. Add some contacts to get started!</p>'}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    async deleteContact(contactId) {
        if (!confirm('Are you sure you want to delete this contact?')) return;

        try {
            const response = await fetch(`http://localhost:3000/api/contacts/${contactId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (response.ok) {
                alert('Contact deleted successfully!');
                this.loadContacts(); // Refresh contacts list
                document.querySelector('.modal').remove();
                this.showContactsModal(); // Refresh the modal
            } else {
                alert('Error deleting contact');
            }
        } catch (error) {
            console.error('Error deleting contact:', error);
            alert('Error deleting contact');
        }
    }

    addNode(type, x, y) {
        this.nodeCounter++;
        const nodeId = `node-${this.nodeCounter}`;
        
        const nodeData = {
            id: nodeId,
            type: type,
            x: x - 100,
            y: y - 30,
            title: this.getNodeTitle(type),
            description: this.getNodeDescription(type)
        };

        this.nodes.push(nodeData);
        this.renderNode(nodeData);
    }

    addStartNode() {
        this.addNode('start', 200, 150);
    }

    getNodeTitle(type) {
        const titles = {
            'start': 'Start',
            'end': 'End',
            'email': 'Email',
            'followup-email': 'Follow-up Email',
            'followup-email2': 'Follow-up Email 2',
            'new-email': 'New Email',
            'voice-call': 'Voice Call',
            'voicemail': 'Voicemail',
            'linkedin': 'LinkedIn Message',
            'wait': 'Wait',
            'condition': 'If / Else',
            'task': 'Task'
        };
        return titles[type] || 'New Node';
    }

    getNodeDescription(type) {
        const descriptions = {
            'start': 'Workflow start point',
            'end': 'Workflow end point',
            'email': 'Send email to prospect',
            'followup-email': 'Send follow-up email',
            'followup-email2': 'Send second follow-up email',
            'new-email': 'Send new email campaign',
            'voice-call': 'Make voice call',
            'voicemail': 'Leave voicemail',
            'linkedin': 'Send LinkedIn message',
            'wait': 'Wait before next action',
            'condition': 'Conditional logic',
            'task': 'Manual task'
        };
        return descriptions[type] || 'Configure this node';
    }

    renderNode(nodeData) {
        const nodesContainer = document.getElementById('workflowNodes');
        const nodeElement = document.createElement('div');
        nodeElement.className = 'workflow-node';
        nodeElement.id = nodeData.id;
        nodeElement.style.left = nodeData.x + 'px';
        nodeElement.style.top = nodeData.y + 'px';

        // Check if this is an email node
        const isEmailNode = ['email', 'followup-email', 'followup-email2', 'new-email'].includes(nodeData.type);
        
        nodeElement.innerHTML = `
            <div class="node-header">
                <div class="node-icon">
                    <i class="${this.getNodeIcon(nodeData.type)}"></i>
                </div>
                <div class="node-title">${nodeData.title}</div>
            </div>
            <div class="node-description">
                ${nodeData.description}
                ${nodeData.config?.to ? `<br><span style="font-size: 11px;">📧 To: ${nodeData.config.to}</span>` : ''}
                ${nodeData.config?.subject ? `<br><span style="font-size: 11px;">📝 ${nodeData.config.subject}</span>` : ''}
                ${nodeData.config?.delayType ? `<br><span style="font-size: 11px;">⏰ ${this.getDelayDescription(nodeData.config)}</span>` : ''}
                ${isEmailNode && !nodeData.config?.to ? '<br><span style="font-size: 11px; color: #666;">Click to configure</span>' : ''}
            </div>
            <div class="connection-point top" data-side="top"></div>
            <div class="connection-point bottom" data-side="bottom"></div>
            <div class="connection-point left" data-side="left"></div>
            <div class="connection-point right" data-side="right"></div>
        `;

        // Add click handler - for email nodes, open config
        nodeElement.addEventListener('click', (e) => {
            if (!e.target.classList.contains('connection-point')) {
                if (isEmailNode) {
                    this.openEmailConfig(nodeData.id);
                } else {
                this.selectNode(nodeData);
                }
            }
        });

        // Add drag functionality
        this.setupNodeDrag(nodeElement, nodeData);

        // Add connection functionality with snap-to-connect
        this.setupConnections(nodeElement, nodeData);

        nodesContainer.appendChild(nodeElement);
    }

    getNodeIcon(type) {
        const icons = {
            'start': 'fas fa-play',
            'end': 'fas fa-stop',
            'email': 'fas fa-envelope',
            'followup-email': 'fas fa-reply',
            'followup-email2': 'fas fa-reply-all',
            'new-email': 'fas fa-envelope-open',
            'voice-call': 'fas fa-phone',
            'voicemail': 'fas fa-microphone',
            'linkedin': 'fab fa-linkedin',
            'wait': 'fas fa-clock',
            'condition': 'fas fa-code-branch',
            'task': 'fas fa-tasks'
        };
        return icons[type] || 'fas fa-circle';
    }

    getDelayDescription(config) {
        if (!config.delayType) return '';
        
        switch(config.delayType) {
            case 'immediate':
                return 'Send immediately';
            case 'minutes':
                return `After ${config.delayValue} min`;
            case 'days':
                return `After ${config.delayValue} days`;
            case 'specific':
                const date = new Date(config.delayValue);
                return `On ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            default:
                return '';
        }
    }

    setupNodeDrag(nodeElement, nodeData) {
        let isDragging = false;
        let startX, startY, startNodeX, startNodeY;

        nodeElement.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('connection-point')) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startNodeX = nodeData.x;
            startNodeY = nodeData.y;
            
            nodeElement.classList.add('dragging');
            document.body.style.cursor = 'grabbing';
            
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            nodeData.x = startNodeX + deltaX;
            nodeData.y = startNodeY + deltaY;
            
            nodeElement.style.left = nodeData.x + 'px';
            nodeElement.style.top = nodeData.y + 'px';
            
            // Redraw all connections when node moves
            this.redrawConnections();
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                nodeElement.classList.remove('dragging');
                document.body.style.cursor = 'default';
            }
        });
    }

    setupConnections(nodeElement, nodeData) {
        const connectionPoints = nodeElement.querySelectorAll('.connection-point');
        
        connectionPoints.forEach(point => {
            point.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.startConnection(nodeData, point.dataset.side, e);
            });
        });
    }

    startConnection(nodeData, side, event) {
        this.isConnecting = true;
        this.connectionStart = { node: nodeData, side: side };
        
        // Create temporary line
        this.createTempLine(nodeData, side, event);
        
        // Add mouse move and up listeners
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    }

    createTempLine(nodeData, side, event) {
        const canvas = document.getElementById('workflowCanvas');
        const nodeElement = document.getElementById(nodeData.id);
        const rect = nodeElement.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        
        let startX, startY;
        switch(side) {
            case 'top':
                startX = rect.left - canvasRect.left + rect.width / 2;
                startY = rect.top - canvasRect.top;
                break;
            case 'bottom':
                startX = rect.left - canvasRect.left + rect.width / 2;
                startY = rect.bottom - canvasRect.top;
                break;
            case 'left':
                startX = rect.left - canvasRect.left;
                startY = rect.top - canvasRect.top + rect.height / 2;
                break;
            case 'right':
                startX = rect.right - canvasRect.left;
                startY = rect.top - canvasRect.top + rect.height / 2;
                break;
        }

        this.tempLine = document.createElement('div');
        this.tempLine.style.position = 'absolute';
        this.tempLine.style.top = '0';
        this.tempLine.style.left = '0';
        this.tempLine.style.width = '100%';
        this.tempLine.style.height = '100%';
        this.tempLine.style.pointerEvents = 'none';
        this.tempLine.style.zIndex = '1000';
        
        this.tempLine.innerHTML = `
            <svg style="width: 100%; height: 100%; position: absolute; top: 0; left: 0;">
                <path d="M ${startX} ${startY} L ${startX} ${startY}" stroke="#3b82f6" stroke-width="2" fill="none" stroke-dasharray="5,5" marker-end="url(#arrowhead)"/>
            </svg>
        `;
        
        canvas.appendChild(this.tempLine);
    }

    handleMouseMove(event) {
        if (!this.isConnecting || !this.tempLine) return;
        
        const canvas = document.getElementById('workflowCanvas');
        const canvasRect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - canvasRect.left;
        const mouseY = event.clientY - canvasRect.top;
        
        const path = this.tempLine.querySelector('path');
        const startX = parseFloat(path.getAttribute('d').split(' ')[1]);
        const startY = parseFloat(path.getAttribute('d').split(' ')[2]);
        
        // Create a curved path for visual appeal
        const midX = (startX + mouseX) / 2;
        path.setAttribute('d', `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${mouseY}, ${mouseX} ${mouseY}`);
        
        // Highlight valid connection points
        document.querySelectorAll('.connection-point').forEach(point => {
            point.classList.remove('highlight');
        });
        
        const element = document.elementFromPoint(event.clientX, event.clientY);
        if (element && element.classList.contains('connection-point')) {
            const targetNode = element.closest('.workflow-node');
            if (targetNode && targetNode.id !== this.connectionStart.node.id) {
                element.classList.add('highlight');
            }
        }
    }

    handleMouseUp(event) {
        if (!this.isConnecting) return;
        
        // Find connection point under mouse
        const element = document.elementFromPoint(event.clientX, event.clientY);
        
        if (element && element.classList.contains('connection-point')) {
            const targetNode = element.closest('.workflow-node');
            const targetNodeData = this.nodes.find(n => n.id === targetNode.id);
            const targetSide = element.dataset.side;
            
            if (targetNodeData && targetNodeData.id !== this.connectionStart.node.id) {
                this.createConnection(this.connectionStart, { node: targetNodeData, side: targetSide });
            }
        }
        
        this.cancelConnection();
    }

    createConnection(start, end) {
        const connection = {
            id: `conn-${Date.now()}`,
            from: start.node.id,
            fromSide: start.side,
            to: end.node.id,
            toSide: end.side
        };

        this.connections.push(connection);
        this.drawConnection(connection);
    }

    drawConnection(connection) {
        const fromNode = document.getElementById(connection.from);
        const toNode = document.getElementById(connection.to);
        
        if (!fromNode || !toNode) return;

        const fromRect = fromNode.getBoundingClientRect();
        const toRect = toNode.getBoundingClientRect();
        const canvas = document.getElementById('workflowCanvas');
        const canvasRect = canvas.getBoundingClientRect();

        const fromPos = this.getConnectionPosition(fromRect, connection.fromSide, canvasRect);
        const toPos = this.getConnectionPosition(toRect, connection.toSide, canvasRect);

        // Create a curved path for better visual appeal
        const controlPoint1X = fromPos.x + (toPos.x - fromPos.x) * 0.5;
        const controlPoint1Y = fromPos.y;
        const controlPoint2X = fromPos.x + (toPos.x - fromPos.x) * 0.5;
        const controlPoint2Y = toPos.y;
        
        const path = `M ${fromPos.x} ${fromPos.y} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${toPos.x} ${toPos.y}`;

        const svg = document.getElementById('connectionsSvg');
        
        // Remove existing connection if it exists
        const existingPath = svg.querySelector(`[data-connection-id="${connection.id}"]`);
        if (existingPath) {
            existingPath.remove();
        }
        
        const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathElement.setAttribute('d', path);
        pathElement.setAttribute('class', 'connection-line');
        pathElement.setAttribute('data-connection-id', connection.id);
        pathElement.setAttribute('stroke', '#3b82f6');
        pathElement.setAttribute('stroke-width', '2');
        pathElement.setAttribute('fill', 'none');
        pathElement.setAttribute('marker-end', 'url(#arrowhead)');

        svg.appendChild(pathElement);
    }
    
    redrawConnections() {
        // Redraw all connections when nodes move
        this.connections.forEach(connection => {
            this.drawConnection(connection);
        });
    }

    getConnectionPosition(rect, side, canvasRect) {
        const x = rect.left - canvasRect.left;
        const y = rect.top - canvasRect.top;
        const width = rect.width;
        const height = rect.height;
        
        switch(side) {
            case 'top':
                return { x: x + width / 2, y: y };
            case 'bottom':
                return { x: x + width / 2, y: y + height };
            case 'left':
                return { x: x, y: y + height / 2 };
            case 'right':
                return { x: x + width, y: y + height / 2 };
            default:
                return { x: x + width / 2, y: y + height };
        }
    }

    cancelConnection() {
        this.isConnecting = false;
        this.connectionStart = null;
        
        if (this.tempLine) {
            this.tempLine.remove();
            this.tempLine = null;
        }
        
        document.removeEventListener('mousemove', this.handleMouseMove.bind(this));
        document.removeEventListener('mouseup', this.handleMouseUp.bind(this));
    }

    selectNode(nodeData) {
        document.querySelectorAll('.workflow-node').forEach(node => {
            node.classList.remove('selected');
        });

        const nodeElement = document.getElementById(nodeData.id);
        nodeElement.classList.add('selected');
        
        this.showConfigPanel(nodeData);
    }

    showConfigPanel(nodeData) {
        const configPanel = document.getElementById('configPanel');
        const configTitle = document.getElementById('configTitle');
        const configContent = document.getElementById('configContent');

        configTitle.textContent = nodeData.title;
        
        let configHTML = '';
        
        if (nodeData.type === 'email' || nodeData.type === 'followup-email' || nodeData.type === 'followup-email2' || nodeData.type === 'new-email') {
            configHTML = `
                <div class="config-section">
                    <h4>Email Subject</h4>
                    <input type="text" id="emailSubject" value="${nodeData.config?.subject || ''}" placeholder="Enter email subject">
                </div>
                <div class="config-section">
                    <h4>Email Template</h4>
                    <textarea id="emailTemplate" rows="10" placeholder="Enter your email template here...">${nodeData.config?.template || ''}</textarea>
                    <small>Use {{name}}, {{email}}, {{company}} for personalization</small>
                </div>
                <div class="config-section">
                    <h4>Delay (Days)</h4>
                    <input type="number" id="emailDelay" value="${nodeData.config?.delay || 0}" min="0" placeholder="Days to wait before sending">
                </div>
                <div class="config-section">
                    <button onclick="workflowBuilder.saveNodeConfig('${nodeData.id}')" class="btn btn-primary">Save Configuration</button>
                </div>
            `;
        } else if (nodeData.type === 'wait') {
            configHTML = `
                <div class="config-section">
                    <h4>Wait Duration</h4>
                    <input type="number" id="waitDuration" value="${nodeData.config?.duration || 1}" min="1" placeholder="Duration">
                </div>
                <div class="config-section">
                    <h4>Time Unit</h4>
                    <select id="waitUnit">
                        <option value="hours" ${nodeData.config?.unit === 'hours' ? 'selected' : ''}>Hours</option>
                        <option value="days" ${nodeData.config?.unit === 'days' ? 'selected' : ''}>Days</option>
                        <option value="weeks" ${nodeData.config?.unit === 'weeks' ? 'selected' : ''}>Weeks</option>
                    </select>
                </div>
                <div class="config-section">
                    <button onclick="workflowBuilder.saveNodeConfig('${nodeData.id}')" class="btn btn-primary">Save Configuration</button>
                </div>
            `;
        } else {
            configHTML = `<p>Configure ${nodeData.title} settings here.</p>`;
        }
        
        configContent.innerHTML = configHTML;
        configPanel.style.display = 'flex';
    }

    saveNodeConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        if (node.type === 'email' || node.type === 'followup-email' || node.type === 'followup-email2' || node.type === 'new-email') {
            node.config = {
                subject: document.getElementById('emailSubject').value,
                template: document.getElementById('emailTemplate').value,
                delay: parseInt(document.getElementById('emailDelay').value) || 0
            };
        } else if (node.type === 'wait') {
            node.config = {
                duration: parseInt(document.getElementById('waitDuration').value) || 1,
                unit: document.getElementById('waitUnit').value
            };
        }

        alert('Configuration saved!');
    }

    closeConfigPanel() {
        document.getElementById('configPanel').style.display = 'none';
        document.querySelectorAll('.workflow-node').forEach(node => {
            node.classList.remove('selected');
        });
    }

    zoomIn() {
        const canvas = document.getElementById('workflowCanvas');
        const currentScale = parseFloat(canvas.style.transform?.match(/scale\(([^)]+)\)/) || [1, 1])[1];
        const newScale = Math.min(currentScale * 1.2, 2);
        canvas.style.transform = `scale(${newScale})`;
    }

    zoomOut() {
        const canvas = document.getElementById('workflowCanvas');
        const currentScale = parseFloat(canvas.style.transform?.match(/scale\(([^)]+)\)/) || [1, 1])[1];
        const newScale = Math.max(currentScale / 1.2, 0.5);
        canvas.style.transform = `scale(${newScale})`;
    }

    undo() {
        console.log('Undo');
    }

    redo() {
        console.log('Redo');
    }

    refresh() {
        console.log('Refresh');
    }

    // New Email Configuration
    openEmailConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'email-config-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
            background: rgba(0,0,0,0.7); display: flex; align-items: center; 
            justify-content: center; z-index: 10000;
        `;
        
        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 12px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto;">
                <h2 style="margin-top: 0;">📧 Configure Email</h2>
                
                <div style="margin-bottom: 20px;">
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Send To (Email):</label>
                        <input type="email" id="emailTo" value="${node.config?.to || ''}" placeholder="recipient@example.com"
                            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Subject:</label>
                        <input type="text" id="emailSubject" value="${node.config?.subject || ''}" placeholder="Email subject"
                            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Message:</label>
                        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 12px; margin-bottom: 10px;">
                            <div style="font-size: 12px; font-weight: 600; color: #0369a1; margin-bottom: 6px;">💡 Template Variables (auto-replaced from LinkedIn):</div>
                            <div style="display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; font-family: monospace; color: #0c4a6e;">
                                <span style="background: white; padding: 4px 8px; border-radius: 4px; border: 1px solid #bae6fd;">{{firstName}}</span>
                                <span style="background: white; padding: 4px 8px; border-radius: 4px; border: 1px solid #bae6fd;">{{lastName}}</span>
                                <span style="background: white; padding: 4px 8px; border-radius: 4px; border: 1px solid #bae6fd;">{{fullName}}</span>
                                <span style="background: white; padding: 4px 8px; border-radius: 4px; border: 1px solid #bae6fd;">{{company}}</span>
                                <span style="background: white; padding: 4px 8px; border-radius: 4px; border: 1px solid #bae6fd;">{{title}}</span>
                                <span style="background: white; padding: 4px 8px; border-radius: 4px; border: 1px solid #bae6fd;">{{email}}</span>
                            </div>
                        </div>
                        <textarea id="emailBody" rows="8" placeholder="Hi {{firstName}}, I noticed you're the {{title}} at {{company}}..."
                            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; resize: vertical;">${node.config?.template || ''}</textarea>
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">When to Send:</label>
                        <select id="delayType" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 10px;">
                            <option value="immediate" ${node.config?.delayType === 'immediate' ? 'selected' : ''}>Send Immediately</option>
                            <option value="minutes" ${node.config?.delayType === 'minutes' ? 'selected' : ''}>After X Minutes</option>
                            <option value="days" ${node.config?.delayType === 'days' ? 'selected' : ''}>After X Days</option>
                            <option value="specific" ${node.config?.delayType === 'specific' ? 'selected' : ''}>Specific Date & Time</option>
                        </select>
                        
                        <div id="delayValueContainer" style="display: ${node.config?.delayType && node.config?.delayType !== 'immediate' ? 'block' : 'none'};">
                            <input type="number" id="delayValueNumber" value="${node.config?.delayValue || 1}" min="1"
                                style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; display: ${node.config?.delayType === 'minutes' || node.config?.delayType === 'days' ? 'block' : 'none'};">
                            <input type="datetime-local" id="delayValueDate" value="${node.config?.delayValue || ''}"
                                style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; display: ${node.config?.delayType === 'specific' ? 'block' : 'none'};">
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;">
                    <button id="cancelEmailBtn"
                        style="padding: 10px 20px; border: 1px solid #ddd; background: white; border-radius: 6px; cursor: pointer;">
                        Cancel
                    </button>
                    <button id="saveEmailBtn"
                        style="padding: 10px 20px; background: #4F46E5; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        Save
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Attach event listeners after modal is in the DOM
        document.getElementById('cancelEmailBtn').addEventListener('click', () => {
            modal.remove();
        });
        
        document.getElementById('saveEmailBtn').addEventListener('click', () => {
            this.saveEmailConfig(nodeId);
        });
        
        // Handle delay type changes
        document.getElementById('delayType').addEventListener('change', (e) => {
            const delayType = e.target.value;
            const container = document.getElementById('delayValueContainer');
            const numberInput = document.getElementById('delayValueNumber');
            const dateInput = document.getElementById('delayValueDate');
            
            if (delayType === 'immediate') {
                container.style.display = 'none';
            } else {
                container.style.display = 'block';
                if (delayType === 'minutes' || delayType === 'days') {
                    numberInput.style.display = 'block';
                    dateInput.style.display = 'none';
                } else if (delayType === 'specific') {
                    numberInput.style.display = 'none';
                    dateInput.style.display = 'block';
                }
            }
        });
    }

    googleSignIn(nodeId) {
        // Open Google OAuth in a new window
        const authWindow = window.open('http://localhost:3000/auth/google', 'Google Sign In', 'width=500,height=600');
        
        // Listen for auth completion
        const checkAuth = setInterval(() => {
            try {
                if (authWindow.closed) {
                    clearInterval(checkAuth);
                    // Check if auth was successful by checking for token
                    const token = localStorage.getItem('authToken');
                    if (token) {
                        this.authToken = token;
                        this.fetchUserAndUpdateNode(nodeId);
                    }
                }
            } catch (e) {
                // Window is closed or cross-origin
            }
        }, 1000);
    }

    async fetchUserAndUpdateNode(nodeId) {
        try {
            const response = await fetch('http://localhost:3000/api/user', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (response.ok) {
                const user = await response.json();
                const node = this.nodes.find(n => n.id === nodeId);
                if (node) {
                    node.config = node.config || {};
                    node.config.googleAuth = true;
                    node.config.googleEmail = user.email;
                    
                    // Refresh the modal
                    document.querySelector('.email-config-modal').remove();
                    this.openEmailConfig(nodeId);
                    
                    // Update the node display
                    this.updateCanvas();
                }
            }
        } catch (error) {
            console.error('Error fetching user:', error);
        }
    }

    saveEmailConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;
        
        node.config = node.config || {};
        node.config.to = document.getElementById('emailTo').value;
        node.config.subject = document.getElementById('emailSubject').value;
        node.config.template = document.getElementById('emailBody').value;
        
        // Save delay configuration
        const delayType = document.getElementById('delayType').value;
        node.config.delayType = delayType;
        
        if (delayType === 'immediate') {
            node.config.delayValue = 0;
        } else if (delayType === 'minutes' || delayType === 'days') {
            node.config.delayValue = parseInt(document.getElementById('delayValueNumber').value) || 1;
        } else if (delayType === 'specific') {
            node.config.delayValue = document.getElementById('delayValueDate').value;
        }
        
        // Update node description
        node.description = node.config.subject || 'Email configured';
        
        // Close modal
        document.querySelector('.email-config-modal').remove();
        
        // Re-render the node to show the updated config visuals
        const nodeElement = document.getElementById(nodeId);
        if (nodeElement) {
            nodeElement.remove();
        }
        this.renderNode(node);
        
        // Redraw all connections
        this.redrawConnections();
    }

    async runWorkflow() {
        // Validate workflow
        if (this.nodes.length === 0) {
            alert('Please add nodes to your workflow');
            return;
        }
        
        const startNode = this.nodes.find(n => n.type === 'start');
        if (!startNode) {
            alert('Workflow must have a Start node');
            return;
        }
        
        const emailNodes = this.nodes.filter(n => 
            ['email', 'followup-email', 'followup-email2', 'new-email'].includes(n.type)
        );
        
        if (emailNodes.length === 0) {
            alert('Workflow must have at least one Email node');
            return;
        }
        
        // Check if all email nodes are configured
        const unconfiguredNodes = emailNodes.filter(n => !n.config?.to || !n.config?.subject || !n.config?.template);
        if (unconfiguredNodes.length > 0) {
            alert('Please configure all email nodes (recipient, subject, and message required)');
            return;
        }
        
        // Execute workflow
        console.log('🚀 Running workflow...');
        try {
            const response = await fetch('http://localhost:3000/api/workflow/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    nodes: this.nodes,
                    connections: this.connections
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                alert(`✅ Workflow executed successfully!\n\n${result.message}`);
            } else if (response.status === 401 || response.status === 403) {
                // Token expired or invalid - clear and prompt re-login
                localStorage.removeItem('authToken');
                alert('⚠️ Session expired. Please log in again.');
                window.location.reload();
            } else {
                const error = await response.json();
                alert(`❌ Error: ${error.error}`);
            }
        } catch (error) {
            alert(`❌ Error running workflow: ${error.message}`);
        }
    }

    async saveCadence() {
        const cadenceName = prompt('Enter a name for this cadence:');
        if (!cadenceName) return;
        
        const cadence = {
            name: cadenceName,
            nodes: this.nodes,
            connections: this.connections,
            savedAt: new Date().toISOString()
        };
        
        // Save to localStorage (for local loading)
        const savedCadences = JSON.parse(localStorage.getItem('savedCadences') || '[]');
        savedCadences.push(cadence);
        localStorage.setItem('savedCadences', JSON.stringify(savedCadences));
        
        // ALSO save to backend database (for extension access)
        try {
            const response = await fetch('http://localhost:3000/api/cadences', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    name: cadenceName,
                    nodes: this.nodes,  // Backend will stringify it
                    connections: this.connections  // Backend will stringify it
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to save to database');
            }
            
            console.log('✅ Cadence saved to database');
        } catch (error) {
            console.error('Error saving to database:', error);
            // Still show success since localStorage save worked
        }
        
        // Show success message
        const message = document.createElement('div');
        message.style.cssText = `
            position: fixed; top: 20px; right: 20px; background: #10B981; color: white;
            padding: 15px 25px; border-radius: 8px; z-index: 10000; font-weight: 600;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        message.textContent = `✅ Cadence "${cadenceName}" saved!`;
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 2000);
    }

    loadCadence() {
        const savedCadences = JSON.parse(localStorage.getItem('savedCadences') || '[]');
        
        if (savedCadences.length === 0) {
            // Show styled message instead of alert
            const message = document.createElement('div');
            message.style.cssText = `
                position: fixed; top: 20px; right: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white; padding: 20px 30px; border-radius: 12px; z-index: 10000; font-weight: 600;
                box-shadow: 0 8px 32px rgba(102, 126, 234, 0.4); animation: slideIn 0.3s ease;
                font-size: 15px; display: flex; align-items: center; gap: 12px;
            `;
            message.innerHTML = `<i class="fas fa-info-circle"></i> <span>No saved cadences yet. Create and save one first!</span>`;
            document.body.appendChild(message);
            setTimeout(() => message.remove(), 3000);
            return;
        }
        
        // Create modal to show list of cadences
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center; z-index: 10000;
            animation: fadeIn 0.2s ease;
        `;
        modal.className = 'cadence-modal-overlay';
        
        const cadenceList = savedCadences.map((cadence, index) => `
            <div class="cadence-card" data-cadence-index="${index}" style="
                padding: 20px; 
                border: 2px solid transparent;
                border-radius: 12px; 
                margin-bottom: 12px; 
                cursor: pointer; 
                background: linear-gradient(white, white) padding-box,
                            linear-gradient(135deg, #667eea 0%, #764ba2 100%) border-box;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                position: relative;
                overflow: hidden;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            ">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <div style="
                        width: 48px; height: 48px; border-radius: 12px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        display: flex; align-items: center; justify-content: center;
                        font-size: 20px; color: white; flex-shrink: 0;
                    ">
                        <i class="fas fa-project-diagram"></i>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 700; font-size: 17px; color: #1f2937; margin-bottom: 6px;">${cadence.name}</div>
                        <div style="font-size: 13px; color: #6b7280; display: flex; align-items: center; gap: 12px;">
                            <span><i class="fas fa-circle-nodes" style="margin-right: 4px;"></i>${cadence.nodes.length} nodes</span>
                            <span><i class="fas fa-calendar" style="margin-right: 4px;"></i>${new Date(cadence.savedAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                    <i class="fas fa-chevron-right" style="color: #9ca3af; font-size: 18px;"></i>
                </div>
            </div>
        `).join('');
        
        modal.innerHTML = `
            <div class="cadence-load-modal" style="
                background: white; 
                padding: 40px; 
                border-radius: 20px; 
                max-width: 600px; 
                width: 90%; 
                max-height: 80vh; 
                overflow-y: auto;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                position: relative;
            ">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
                    <div>
                        <h2 style="margin: 0; font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
                            Load Cadence
                        </h2>
                        <p style="margin: 8px 0 0 0; color: #6b7280; font-size: 14px;">Select a saved workflow to continue</p>
                    </div>
                    <button class="close-modal-btn" style="
                        width: 40px; height: 40px; border: none; background: #f3f4f6; 
                        border-radius: 10px; cursor: pointer; font-size: 20px; color: #6b7280;
                        transition: all 0.2s; display: flex; align-items: center; justify-content: center;
                    ">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="cadence-list-container" style="margin: 0;">
                    ${cadenceList}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Prevent modal content from closing when clicked
        const modalContent = modal.querySelector('.cadence-load-modal');
        modalContent.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Add event listeners after modal is in DOM
        const closeBtn = modal.querySelector('.close-modal-btn');
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        closeBtn.addEventListener('mouseover', () => {
            closeBtn.style.background = '#e5e7eb';
            closeBtn.style.color = '#374151';
        });
        
        closeBtn.addEventListener('mouseout', () => {
            closeBtn.style.background = '#f3f4f6';
            closeBtn.style.color = '#6b7280';
        });
        
        // Add click listeners to each cadence card
        const cadenceCards = modal.querySelectorAll('.cadence-card');
        console.log('📋 Found cadence cards:', cadenceCards.length);
        
        cadenceCards.forEach((card, idx) => {
            console.log(`📋 Setting up card ${idx}, index: ${card.dataset.cadenceIndex}`);
            
            card.addEventListener('mouseover', () => {
                card.style.transform = 'translateY(-4px) scale(1.02)';
                card.style.boxShadow = '0 12px 24px rgba(102, 126, 234, 0.3)';
            });
            
            card.addEventListener('mouseout', () => {
                card.style.transform = 'translateY(0) scale(1)';
                card.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
            });
            
            card.addEventListener('click', (e) => {
                console.log('🖱️ Card clicked!', e.target);
                const index = parseInt(card.dataset.cadenceIndex);
                console.log('📋 Loading cadence at index:', index);
                this.loadCadenceByIndex(index);
                document.body.removeChild(modal);
            });
        });
        
        // Close modal when clicking backdrop
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }

    loadCadenceByIndex(index) {
        console.log('🔄 loadCadenceByIndex called with index:', index);
        const savedCadences = JSON.parse(localStorage.getItem('savedCadences') || '[]');
        console.log('📋 Total saved cadences:', savedCadences.length);
        const cadence = savedCadences[index];
        console.log('📋 Loading cadence:', cadence);
        
        if (!cadence) {
            console.error('❌ No cadence found at index:', index);
            return;
        }
        
        // Clear current workflow
        const svg = document.getElementById('connectionsSvg');
        svg.innerHTML = `
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                        refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
                </marker>
            </defs>
        `;
        document.getElementById('workflowNodes').innerHTML = '';
        
        // Load nodes and connections
        this.nodes = cadence.nodes;
        this.connections = cadence.connections;
        
        // Update node counter to avoid ID conflicts
        const maxCounter = this.nodes.reduce((max, node) => {
            const match = node.id.match(/node-(\d+)/);
            return match ? Math.max(max, parseInt(match[1])) : max;
        }, 0);
        this.nodeCounter = maxCounter;
        
        // Render all nodes with proper event listeners
        this.nodes.forEach(node => this.renderNode(node));
        
        // Redraw all connections
        this.redrawConnections();
        
        // Show success message
        const message = document.createElement('div');
        message.style.cssText = `
            position: fixed; top: 20px; right: 20px; background: #10B981; color: white;
            padding: 15px 25px; border-radius: 8px; z-index: 10000; font-weight: 600;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1); animation: slideIn 0.3s ease;
        `;
        message.textContent = `✅ Cadence "${cadence.name}" loaded!`;
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 2000);
    }
    
    // View switching
    switchView(viewName) {
        console.log('🔄 Switching to view:', viewName);
        
        // Update tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === viewName);
        });
        
        // Update views
        document.querySelectorAll('.view-content').forEach(view => {
            const shouldShow = view.dataset.view === viewName;
            view.style.display = shouldShow ? 'block' : 'none';
            console.log(`View ${view.dataset.view}: ${shouldShow ? 'shown' : 'hidden'}`);
        });
        
        // Update buttons visibility
        if (viewName === 'builder') {
            document.getElementById('saveCadenceBtn').style.display = 'inline-block';
            document.getElementById('loadCadenceBtn').style.display = 'inline-block';
            document.getElementById('runWorkflowBtn').style.display = 'inline-block';
        } else {
            document.getElementById('saveCadenceBtn').style.display = 'none';
            document.getElementById('loadCadenceBtn').style.display = 'none';
            document.getElementById('runWorkflowBtn').style.display = 'none';
        }
        
        // Load data for the view
        if (viewName === 'contacts') {
            console.log('📥 Loading contacts...');
            this.loadContacts();
        } else if (viewName === 'cadences') {
            console.log('📥 Loading cadences...');
            this.loadCadencesView();
        }
    }
    
    // Load contacts from backend
    async loadContacts() {
        console.log('🔄 loadContacts() called');
        console.log('Auth token:', this.authToken ? 'Present' : 'Missing');
        
        try {
            const response = await fetch('http://localhost:3000/api/contacts', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            console.log('API response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('API error:', errorText);
                throw new Error(`Failed to load contacts: ${response.status}`);
            }
            
            const contacts = await response.json();
            console.log('✅ Loaded contacts:', contacts.length);
            this.renderContacts(contacts);
        } catch (error) {
            console.error('❌ Error loading contacts:', error);
            document.getElementById('contactsList').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-circle"></i>
                    <h3>Error loading contacts</h3>
                    <p>${error.message}</p>
                    <button onclick="workflowBuilder.loadContacts()" class="btn btn-primary" style="margin-top: 20px;">Retry</button>
                </div>
            `;
        }
    }
    
    // Render contacts list
    renderContacts(contacts) {
        const container = document.getElementById('contactsList');
        
        if (contacts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-user-plus"></i>
                    <h3>No contacts yet</h3>
                    <p>Add contacts from LinkedIn using the Chrome extension</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = contacts.map(contact => `
            <div class="contact-card">
                <div class="contact-header">
                    <div class="contact-name">
                        ${contact.name || contact.email}
                    </div>
                    <span class="cadence-badge">Active</span>
                </div>
                <div class="contact-info">
                    <div class="info-item">
                        <i class="fas fa-envelope"></i>
                        <span>${contact.email}</span>
                    </div>
                    ${contact.company ? `
                        <div class="info-item">
                            <i class="fas fa-building"></i>
                            <span>${contact.company}</span>
                        </div>
                    ` : ''}
                    ${contact.title ? `
                        <div class="info-item">
                            <i class="fas fa-briefcase"></i>
                            <span>${contact.title}</span>
                        </div>
                    ` : ''}
                    ${contact.linkedin_url ? `
                        <div class="info-item">
                            <i class="fab fa-linkedin"></i>
                            <a href="${contact.linkedin_url}" target="_blank" style="color: #3b82f6;">View Profile</a>
                        </div>
                    ` : ''}
                    <div class="info-item">
                        <i class="fas fa-clock"></i>
                        <span>Added ${new Date(contact.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    // Load cadences view
    async loadCadencesView() {
        try {
            const response = await fetch('http://localhost:3000/api/cadences', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (!response.ok) throw new Error('Failed to load cadences');
            
            const cadences = await response.json();
            this.renderCadencesView(cadences);
        } catch (error) {
            console.error('Error loading cadences:', error);
            document.getElementById('cadencesList').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-circle"></i>
                    <h3>Error loading cadences</h3>
                    <p>${error.message}</p>
                </div>
            `;
        }
    }
    
    // Render cadences view
    renderCadencesView(cadences) {
        const container = document.getElementById('cadencesList');
        
        if (cadences.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-project-diagram"></i>
                    <h3>No cadences yet</h3>
                    <p>Create your first cadence in the Builder tab</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = cadences.map(cadence => {
            const nodes = typeof cadence.nodes === 'string' ? JSON.parse(cadence.nodes) : cadence.nodes;
            const emailCount = nodes.filter(n => n.type === 'email' || n.type.includes('email')).length;
            const contactCount = cadence.contactCount || 0;
            
            return `
                <div class="cadence-card-item" style="cursor: pointer; transition: all 0.2s;">
                    <div class="contact-header" style="align-items: flex-start;">
                        <div>
                            <div class="contact-name" style="margin-bottom: 8px;">
                                ${cadence.name}
                            </div>
                            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                                <div class="info-item">
                                    <i class="fas fa-envelope"></i>
                                    <span>${emailCount} Email${emailCount !== 1 ? 's' : ''}</span>
                                </div>
                                <div class="info-item" style="${contactCount > 0 ? 'color: #10B981; font-weight: 600;' : ''}">
                                    <i class="fas fa-users"></i>
                                    <span>${contactCount} Contact${contactCount !== 1 ? 's' : ''}</span>
                                </div>
                                <div class="info-item">
                                    <i class="fas fa-clock"></i>
                                    <span>${new Date(cadence.created_at).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-secondary" onclick="event.stopPropagation(); workflowBuilder.viewCadenceContacts(${cadence.id}, '${cadence.name.replace(/'/g, "\\'")}')">
                                <i class="fas fa-users"></i> View Contacts
                            </button>
                            <button class="btn btn-primary" onclick="event.stopPropagation(); workflowBuilder.loadCadenceById(${cadence.id})">
                                <i class="fas fa-edit"></i> Edit
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // Add click handler to each card
        container.querySelectorAll('.cadence-card-item').forEach((card, index) => {
            card.addEventListener('click', () => {
                this.viewCadenceContacts(cadences[index].id, cadences[index].name);
            });
        });
    }
    
    // View contacts in a cadence
    async viewCadenceContacts(cadenceId, cadenceName) {
        try {
            console.log('📋 Viewing contacts for cadence:', cadenceId);
            
            const response = await fetch(`http://localhost:3000/api/cadences/${cadenceId}/contacts`, {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (!response.ok) throw new Error('Failed to load cadence contacts');
            
            const contacts = await response.json();
            
            // Create modal to show contacts
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px);
                display: flex; align-items: center; justify-content: center; z-index: 10000;
            `;
            
            const contactsList = contacts.length > 0 ? contacts.map(contact => `
                <div style="
                    background: #f9fafb;
                    padding: 15px;
                    border-radius: 8px;
                    margin-bottom: 10px;
                    border-left: 4px solid #10B981;
                ">
                    <div style="font-weight: 600; color: #1f2937; margin-bottom: 5px;">${contact.name}</div>
                    <div style="font-size: 13px; color: #6b7280;">${contact.email}</div>
                    ${contact.company ? `<div style="font-size: 13px; color: #6b7280; margin-top: 3px;"><i class="fas fa-building"></i> ${contact.company}</div>` : ''}
                </div>
            `).join('') : '<p style="text-align: center; color: #6b7280; padding: 40px;">No contacts in this cadence yet</p>';
            
            modal.innerHTML = `
                <div style="
                    background: white;
                    border-radius: 16px;
                    padding: 30px;
                    max-width: 600px;
                    width: 90%;
                    max-height: 80vh;
                    overflow-y: auto;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h3 style="margin: 0; font-size: 22px; color: #1f2937;">
                            <i class="fas fa-users"></i> ${cadenceName}
                        </h3>
                        <button onclick="this.closest('div[style*=fixed]').remove()" style="
                            background: none;
                            border: none;
                            font-size: 24px;
                            color: #6b7280;
                            cursor: pointer;
                            padding: 5px 10px;
                        ">&times;</button>
                    </div>
                    <p style="color: #6b7280; margin-bottom: 20px; font-size: 14px;">
                        ${contacts.length} contact${contacts.length !== 1 ? 's' : ''} in this cadence
                    </p>
                    ${contactsList}
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });
            
        } catch (error) {
            console.error('Error viewing cadence contacts:', error);
            alert('Failed to load contacts');
        }
    }
    
    // Load specific cadence by ID
    async loadCadenceById(cadenceId) {
        try {
            const response = await fetch(`http://localhost:3000/api/cadences`, {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (!response.ok) throw new Error('Failed to load cadence');
            
            const cadences = await response.json();
            const cadence = cadences.find(c => c.id === cadenceId);
            
            if (cadence) {
                this.nodes = typeof cadence.nodes === 'string' ? JSON.parse(cadence.nodes) : cadence.nodes;
                this.connections = typeof cadence.connections === 'string' ? JSON.parse(cadence.connections) : cadence.connections;
                this.switchView('builder');
                this.rerenderWorkflow();
                
                const message = document.createElement('div');
                message.style.cssText = `
                    position: fixed; top: 20px; right: 20px; background: #10B981; color: white;
                    padding: 15px 25px; border-radius: 8px; z-index: 10000; font-weight: 600;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                `;
                message.textContent = `✅ Cadence "${cadence.name}" loaded!`;
                document.body.appendChild(message);
                setTimeout(() => message.remove(), 2000);
            }
        } catch (error) {
            console.error('Error loading cadence:', error);
            alert('Failed to load cadence');
        }
    }
}

// Initialize
let workflowBuilder;
let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
    workflowBuilder = new WorkflowBuilder();
});