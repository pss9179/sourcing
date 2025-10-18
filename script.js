// Simple Workflow Builder
class WorkflowBuilder {
    constructor() {
        this.nodes = [];
        this.connections = [];
        this.nodeCounter = 0;
        this.isConnecting = false;
        this.connectionStart = null;
        this.tempLine = null;
        this.authToken = null;
        this.user = null;
        this.contacts = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuth();
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

        // Contact management buttons
        document.getElementById('addContactBtn').addEventListener('click', () => this.showAddContactModal());
        document.getElementById('viewContactsBtn').addEventListener('click', () => this.showContactsModal());
    }

    // Authentication methods
    checkAuth() {
        // Check for token in URL first (from OAuth callback)
        const urlParams = new URLSearchParams(window.location.search);
        const urlToken = urlParams.get('token');
        
        if (urlToken) {
            // Store token from OAuth callback
            localStorage.setItem('authToken', urlToken);
            this.authToken = urlToken;
            this.fetchUser();
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
        }
        
        // Check for stored token
        const token = localStorage.getItem('authToken');
        if (token) {
            this.authToken = token;
            this.fetchUser();
        } else {
            this.showLogin();
        }
    }

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
                ${isEmailNode ? `<button class="node-settings-btn" onclick="workflowBuilder.openEmailConfig('${nodeData.id}')" style="background: none; border: none; cursor: pointer; font-size: 16px; position: absolute; right: 5px; top: 5px;">⚙️</button>` : ''}
            </div>
            <div class="node-description">
                ${nodeData.description}
                ${nodeData.config?.googleAuth ? '<br><span style="color: green; font-size: 11px;">✓ Google Connected</span>' : ''}
                ${nodeData.config?.to ? `<br><span style="font-size: 11px;">To: ${nodeData.config.to}</span>` : ''}
            </div>
            <div class="connection-point top" data-side="top"></div>
            <div class="connection-point bottom" data-side="bottom"></div>
            <div class="connection-point left" data-side="left"></div>
            <div class="connection-point right" data-side="right"></div>
        `;

        // Add click handler for selection
        nodeElement.addEventListener('click', (e) => {
            if (!e.target.classList.contains('connection-point') && !e.target.classList.contains('node-settings-btn')) {
                this.selectNode(nodeData);
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
                <h2 style="margin-top: 0;">📧 Configure Email Node</h2>
                
                ${!node.config?.googleAuth ? `
                    <div style="background: #f0f9ff; border: 2px solid #3b82f6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h3 style="margin-top: 0;">Step 1: Connect Google Account</h3>
                        <p>Sign in with Google to send emails through Gmail</p>
                        <button onclick="workflowBuilder.googleSignIn('${nodeId}')" style="padding: 10px 20px; background: #4285f4; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                            🔐 Sign in with Google
                        </button>
                    </div>
                ` : `
                    <div style="background: #d4edda; border: 2px solid #28a745; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                        <strong>✅ Google Account Connected</strong><br>
                        <small>${node.config.googleEmail || 'Connected'}</small>
                    </div>
                `}
                
                <div style="${!node.config?.googleAuth ? 'opacity: 0.5; pointer-events: none;' : ''}">
                    <h3>Step 2: Configure Email</h3>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">To (Email Address):</label>
                        <input type="email" id="emailTo" value="${node.config?.to || ''}" 
                            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Subject:</label>
                        <input type="text" id="emailSubject" value="${node.config?.subject || ''}" 
                            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Message:</label>
                        <textarea id="emailBody" rows="8" 
                            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; resize: vertical;">${node.config?.template || ''}</textarea>
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Delay (days after previous node):</label>
                        <input type="number" id="emailDelay" value="${node.config?.delay || 0}" min="0"
                            style="width: 100px; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
                    </div>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;">
                    <button onclick="document.querySelector('.email-config-modal').remove()" 
                        style="padding: 10px 20px; border: 1px solid #ddd; background: white; border-radius: 6px; cursor: pointer;">
                        Cancel
                    </button>
                    <button onclick="workflowBuilder.saveEmailConfig('${nodeId}')" 
                        style="padding: 10px 20px; background: #4F46E5; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        Save Configuration
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
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
        node.config.delay = parseInt(document.getElementById('emailDelay').value) || 0;
        
        // Update node description
        node.description = node.config.subject || 'Email configured';
        
        // Close modal
        document.querySelector('.email-config-modal').remove();
        
        // Update canvas
        this.updateCanvas();
        
        alert('✅ Email configuration saved!');
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
        const unconfiguredNodes = emailNodes.filter(n => !n.config?.googleAuth || !n.config?.to);
        if (unconfiguredNodes.length > 0) {
            alert('Please configure all email nodes (click the ⚙️ icon)');
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
            } else {
                const error = await response.json();
                alert(`❌ Error: ${error.error}`);
            }
        } catch (error) {
            alert(`❌ Error running workflow: ${error.message}`);
        }
    }
}

// Initialize
let workflowBuilder;
document.addEventListener('DOMContentLoaded', () => {
    workflowBuilder = new WorkflowBuilder();
    
    // Handle auth success
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
        localStorage.setItem('authToken', token);
        workflowBuilder.authToken = token;
        workflowBuilder.fetchUser();
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});