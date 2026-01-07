const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://mobokomuxbfqbuzwasbe.supabase.co'
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vYm9rb211eGJmcWJ1endhc2JlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzcxNTgxMiwiZXhwIjoyMDgzMjkxODEyfQ.ZiMtCiJbXqdyTBbOvCcxyJJuHtQ7T8NZ_mt3OdwPKS8'

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function createAdminUser() {
  const email = 'admin@workspace.local'
  const password = 'Plmplmplm1'
  const displayName = 'Admin'
  const role = 'main_admin'

  console.log('Setting up admin user...')

  // First, add username column to profiles if it doesn't exist
  console.log('Adding username column to profiles table...')

  // Check if there's an existing main_admin profile we can update
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('user_id, display_name, role')
    .eq('role', 'main_admin')
    .limit(1)
    .single()

  if (existingProfile) {
    console.log('Found existing main_admin profile:', existingProfile.user_id)

    // Update the password for this user
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      existingProfile.user_id,
      {
        email: email,
        password: password,
        email_confirm: true
      }
    )

    if (updateError) {
      console.error('Failed to update user:', updateError)
      return
    }

    console.log('Admin user credentials updated!')
    console.log('')
    console.log('Login credentials:')
    console.log('  Username: admin')
    console.log('  Password: Plmplmplm1')
    console.log('')
    console.log('Note: Login with "admin" as username (the system will look up the email)')
    return
  }

  // Get workspace ID
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .limit(1)
    .single()

  if (!workspace) {
    console.error('No workspace found!')
    return
  }

  // Delete the orphaned auth user we created before (if exists)
  const { data: users } = await supabase.auth.admin.listUsers()
  const orphanedUser = users?.users?.find(u => u.email === email)
  if (orphanedUser) {
    console.log('Cleaning up orphaned user...')
    await supabase.auth.admin.deleteUser(orphanedUser.id)
  }

  // Create new auth user
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })

  if (authError) {
    console.error('Failed to create auth user:', authError)
    return
  }

  console.log('Auth user created:', authUser.user.id)

  // Create profile (without username since column doesn't exist)
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({
      user_id: authUser.user.id,
      display_name: displayName,
      role,
      workspace_id: workspace.id
    })

  if (profileError) {
    console.error('Failed to create profile:', profileError)
    await supabase.auth.admin.deleteUser(authUser.user.id)
    return
  }

  console.log('Admin user created!')
  console.log('')
  console.log('Login credentials:')
  console.log('  Email: admin@workspace.local')
  console.log('  Password: Plmplmplm1')
}

createAdminUser()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err)
    process.exit(1)
  })
