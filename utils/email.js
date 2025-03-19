const sgMail = require('@sendgrid/mail');
require('dotenv').config();

// Set SendGrid API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Send a magic link email for authentication
 * @param {string} email - Recipient email
 * @param {string} token - Authentication token
 * @param {string} baseUrl - Base URL for the application (e.g., http://localhost:3000)
 * @returns {Promise} - SendGrid response
 */
const sendMagicLink = async (email, token, baseUrl) => {
  // Create verify URL
  const verifyUrl = `${baseUrl}/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;
  
  // Email content
  const msg = {
    to: email,
    from: process.env.EMAIL_FROM || 'noreply@basketballpool2025.com', // Use verified sender
    subject: 'Basketball Pool 2025 - Sign In',
    text: `Click the link below to sign in to your Basketball Pool 2025 account:\n\n${verifyUrl}\n\nThis link will expire in 24 hours.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e40af;">Basketball Pool 2025</h2>
        <p>Click the button below to sign in to your Basketball Pool 2025 account:</p>
        <div style="margin: 30px 0;">
          <a href="${verifyUrl}" style="background-color: #1e40af; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
            Sign In
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">This link will expire in 24 hours.</p>
        <p style="color: #666; font-size: 14px;">If you didn't request this email, you can safely ignore it.</p>
      </div>
    `
  };
  
  // Send email
  try {
    return await sgMail.send(msg);
  } catch (error) {
    console.error('SendGrid Error:', error);
    if (error.response) {
      console.error('SendGrid Response Error:', error.response.body);
    }
    throw error;
  }
};

/**
 * Send a bracket confirmation email
 * @param {string} email - Recipient email
 * @param {object} bracketDetails - Details about the bracket
 * @param {string} baseUrl - Base URL for the application
 * @returns {Promise} - SendGrid response
 */
const sendBracketConfirmation = async (email, bracketDetails, baseUrl) => {
  // Create bracket URLs
  const viewUrl = `${baseUrl}/bracket/view/${bracketDetails.bracketId}?token=${bracketDetails.editToken}`;
  const editUrl = `${baseUrl}/bracket/edit/${bracketDetails.bracketId}?token=${bracketDetails.editToken}`;
  const userBracketsUrl = bracketDetails.userToken ? 
    `${baseUrl}/user/brackets/${email}?token=${bracketDetails.userToken}` : null;
  
  // Add entry number information if this is a multiple entry
  const entryInfo = bracketDetails.totalEntries > 1 ? 
    `(Entry #${bracketDetails.entryNumber} of ${bracketDetails.totalEntries})` : '';
  
  // Email content
  const msg = {
    to: email,
    from: process.env.EMAIL_FROM || 'noreply@kyleaskine.com',
    subject: 'Your March Madness 2025 Bracket Confirmation',
    text: `
Thank you for submitting your bracket for Kyle's Basketball Pool 2025!

Participant Name: ${bracketDetails.participantName} ${entryInfo}

Important: Save These Links

Edit Link (before tournament starts):
${editUrl}

View Link (works during tournament):
${viewUrl}

${userBracketsUrl ? `Access All Your Brackets:
${userBracketsUrl}` : ''}

Remember: The tournament begins on March 20, 2025 at Noon. After that date, brackets will be locked and you won't be able to make any changes.
    `,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e40af;">Kyle's 2025 Bracket Confirmation</h2>
        <p>Thank you for submitting your bracket for March Madness 2025!</p>
        
        <p><strong>Participant Name:</strong> ${bracketDetails.participantName} ${entryInfo ? `<span style="color: #4B5563; font-style: italic;">${entryInfo}</span>` : ''}</p>
        
        <div style="background-color: #f0f4ff; border-left: 4px solid #1e40af; padding: 15px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #1e40af;">Important: Save These Links</h3>
          ${userBracketsUrl ? `
            <p><strong>Access All Your Brackets:</strong></p>
            <p><a href="${userBracketsUrl}" style="word-break: break-all;">${userBracketsUrl}</a></p>
            ` : ''}

          <p><strong>Edit Link</strong> (before tournament starts):</p>
          <p><a href="${editUrl}" style="word-break: break-all;">${editUrl}</a></p>
          
          <p><strong>View Link</strong> (works during tournament):</p>
          <p><a href="${viewUrl}" style="word-break: break-all;">${viewUrl}</a></p>
          
        </div>
        
        <div style="background-color: #fff8e6; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
          <p style="margin-top: 0;"><strong>Reminder:</strong> The tournament begins on March 20, 2025 at Noon. After that date, brackets will be locked and you won't be able to make any changes.</p>
        </div>
      </div>
    `
  };
  
  // Send email
  try {
    return await sgMail.send(msg);
  } catch (error) {
    console.error('SendGrid Error:', error);
    if (error.response) {
      console.error('SendGrid Response Error:', error.response.body);
    }
    throw error;
  }
};

module.exports = {
  sendMagicLink,
  sendBracketConfirmation
};